import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, serverTimestamp, setDoc } from 'firebase/firestore';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rules = fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8');
const projectId = 'tad-lab-manager-staff-report-test';

const env = await initializeTestEnvironment({
  projectId,
  firestore: { rules, host: '127.0.0.1', port: 8080 },
});

try {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async ctx => {
    await setDoc(doc(ctx.firestore(), 'machines', 'test-machine'), {
      name: 'Test Machine',
      room: 'TEST'
    });
  });

  const db = env.authenticatedContext('staff-user', {
    email: 'eric.carlson.2@bemidjistate.edu',
    email_verified: true,
    firebase: { sign_in_provider: 'password' },
  }).firestore();

  await assertSucceeds(setDoc(doc(collection(db, 'reports')), {
    machineId: 'test-machine',
    createdAt: serverTimestamp(),
    urgency: 'Low',
    usable: 'Yes',
    issue: 'Staff lifecycle test',
    attempted: '',
    contact: '',
    resource: '',
    status: 'Open',
    machineNameSnapshot: 'Test Machine',
    roomSnapshot: 'TEST',
    submittedByUid: 'staff-user',
    submittedByEmail: 'eric.carlson.2@bemidjistate.edu',
  }));

  console.log('PASS: authorized staff can submit a report without anonymous rate counters');
} finally {
  await env.cleanup();
}
