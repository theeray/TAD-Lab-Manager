import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, runTransaction, serverTimestamp, setDoc } from 'firebase/firestore';

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

  await assertSucceeds(runTransaction(db, async tx => {
    const reportRef = doc(collection(db, 'reports'));
    const machineStatusRef = doc(db, 'machineStatus', 'test-machine');
    const statusSnap = await tx.get(machineStatusRef);

    tx.set(reportRef, {
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
    });

    if (!statusSnap.exists() || !['Attention', 'Out of Service'].includes(statusSnap.data()?.status)) {
      tx.set(machineStatusRef, {
        machineId: 'test-machine',
        status: 'Report Pending',
        pendingReportId: reportRef.id,
        updatedAt: serverTimestamp(),
      });
    }
  }));

  console.log('PASS: authorized staff can submit the exact report + machine-status transaction without anonymous rate counters');
} finally {
  await env.cleanup();
}
