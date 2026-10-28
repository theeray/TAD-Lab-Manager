'use strict';
// Read-only deployment diagnostics. Never request or log secret payloads.
const path = require('node:path');
const { createRequire } = require('node:module');
const backendRequire = createRequire(path.resolve(__dirname, '../checkout-functions/package.json'));
const { GoogleAuth } = backendRequire('google-auth-library');
const project = 'tad-lab-manager';
const runtime = `${project}@appspot.gserviceaccount.com`;
const emailSecrets = ['GMAIL_SMTP_USER', 'GMAIL_APP_PASSWORD'];
const apis = ['firestore', 'cloudfunctions', 'cloudbuild', 'artifactregistry', 'run', 'eventarc', 'pubsub', 'cloudscheduler', 'secretmanager', 'sheets'];
async function inspect(client, url, data) {
  try {
    const response = await client.request({ url, method: data ? 'POST' : 'GET', ...(data ? { data } : {}), timeout: 15000 });
    return { ok: true, data: response.data };
  } catch (error) {
    return { ok: false, http: error.response?.status || null, status: error.response?.data?.error?.status || 'UNAVAILABLE' };
  }
}
function inaccessible(result) { return { readable: false, http: result.http, status: result.status }; }
async function main() {
  const client = await new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] }).getClient();
  const details = await inspect(client, `https://cloudresourcemanager.googleapis.com/v1/projects/${project}`);
  if (!details.ok) { console.log('Project metadata:', JSON.stringify(inaccessible(details))); return; }
  const number = details.data.projectNumber;
  const permissions = ['resourcemanager.projects.getIamPolicy', 'resourcemanager.projects.setIamPolicy', 'serviceusage.services.enable',
    'cloudfunctions.functions.create', 'cloudfunctions.functions.update', 'cloudfunctions.functions.setIamPolicy',
    'cloudscheduler.jobs.create', 'cloudscheduler.jobs.update', 'cloudscheduler.jobs.get', 'run.services.get', 'run.services.setIamPolicy'];
  await Promise.all([
    ...apis.map(async api => {
      const result = await inspect(client, `https://serviceusage.googleapis.com/v1/projects/${number}/services/${api}.googleapis.com`);
      console.log('API:', JSON.stringify({ api, ...(result.ok ? { state: result.data.state } : inaccessible(result)) }));
    }),
    ...emailSecrets.map(async secret => {
      const base = `https://secretmanager.googleapis.com/v1/projects/${project}/secrets/${secret}`;
      const [metadata, version, policy] = await Promise.all([
        inspect(client, base), inspect(client, `${base}/versions/latest`), inspect(client, `${base}:getIamPolicy`),
      ]);
      const runtimeDirectAccess = policy.ok ? (policy.data.bindings || []).some(binding =>
        binding.role === 'roles/secretmanager.secretAccessor' && !binding.condition && binding.members?.includes(`serviceAccount:${runtime}`)) : null;
      console.log('Secret metadata:', JSON.stringify({ secret,
        metadata: metadata.ok ? { readable: true } : inaccessible(metadata),
        latestVersion: version.ok ? { readable: true, state: version.data.state } : inaccessible(version),
        runtimeDirectAccess, policy: policy.ok ? { readable: true } : inaccessible(policy),
      }));
    }),
    (async () => {
      const result = await inspect(client, `https://cloudresourcemanager.googleapis.com/v1/projects/${project}:testIamPermissions`, { permissions });
      console.log('Deployer permissions (diagnostic, not a grant list):', JSON.stringify(result.ok
        ? { granted: result.data.permissions || [], absent: permissions.filter(permission => !result.data.permissions?.includes(permission)) }
        : inaccessible(result)));
    })(),
    (async () => {
      const result = await inspect(client, `https://iam.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(runtime)}:testIamPermissions`, { permissions: ['iam.serviceAccounts.actAs'] });
      console.log('Runtime assignment:', JSON.stringify(result.ok ? { actAs: result.data.permissions?.includes('iam.serviceAccounts.actAs') === true } : inaccessible(result)));
    })(),
  ]);
}
main().catch(() => { console.error('Deployment metadata inspection could not run. No secret payloads were requested.'); process.exitCode = 1; });
