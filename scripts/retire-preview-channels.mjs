import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROJECT = 'tad-lab-manager';
export const CUTOFF = '2026-10-21T18:24:38Z';
export const DESTINATION = 'https://tad-lab-manager.web.app';

export function legacyChannels(channels) {
  return channels.filter(channel => {
    const id = channel.name?.split('/').pop();
    return id && id !== 'live' && channel.createTime &&
      Date.parse(channel.createTime) <= Date.parse(CUTOFF);
  });
}

export function run() {
  const firebase = args => execFileSync('npx', ['--yes', 'firebase-tools@15.34.0', ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit']
  });
  const listed = JSON.parse(firebase(['hosting:channel:list', '--project', PROJECT,
    '--site', PROJECT, '--json', '--non-interactive']));
  if (listed.status !== 'success' || !Array.isArray(listed.result?.channels)) {
    throw new Error('Could not list Hosting channels; no changes made.');
  }
  const sitesResult = JSON.parse(firebase(['hosting:sites:list', '--project', PROJECT, '--json', '--non-interactive']));
  if (sitesResult.status !== 'success') throw new Error('Could not inventory Hosting sites.');
  console.log('Hosting site inventory:', JSON.stringify(sitesResult.result));
  const all = listed.result.channels;
  const retired = legacyChannels(all);
  const folder = resolve('.local/legacy-redirects');
  mkdirSync(folder + '/public', { recursive: true });
  writeFileSync(folder + '/public/index.html', '<!doctype html><title>TAD Lab Manager</title><a href="' + DESTINATION + '/">Open TAD Lab Manager</a>');
  const configPath = folder + '/firebase.json';
  writeFileSync(configPath, JSON.stringify({ hosting: {
    site: PROJECT,
    public: folder + '/public',
    redirects: [
      { source: '/', destination: DESTINATION + '/', type: 301 },
      { source: '/:path*', destination: DESTINATION + '/:path', type: 301 }
    ]
  } }, null, 2));
  const summary = ['# Legacy Lab Manager links', '',
    'Permanent site: ' + DESTINATION + '/', '',
    'Only existing preview channels created before ' + CUTOFF + ' are retired. The live channel is never modified.', ''];
  for (const channel of retired) {
    const id = channel.name.split('/').pop();
    if (!/^[a-z0-9_-]+$/.test(id) || id === 'live') throw new Error('Unexpected preview channel ID.');
    console.log('Redirecting existing preview:', id, channel.url);
    const result = JSON.parse(firebase(['hosting:channel:deploy', id, '--project', PROJECT,
      '--config', configPath, '--expires', '30d', '--json', '--non-interactive']));
    if (result.status !== 'success') throw new Error('Preview redirect deployment failed: ' + id);
    summary.push('- Redirected ' + channel.url + ' (renewed for 30 days).');
  }
  if (!retired.length) summary.push('No existing legacy preview channels remain. Expired URLs cannot be redirected after Firebase removes their channels.');
  summary.push('', 'Current channels:', ...all.map(c => '- ' + c.name.split('/').pop() + ': ' + c.url));
  const report = summary.join('\n') + '\n';
  console.log(report);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) run();
