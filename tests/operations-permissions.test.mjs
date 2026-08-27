import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  doc,
  serverTimestamp,
  setDoc,
  updateDoc,
  Timestamp,
} from 'firebase/firestore';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rules = fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8');
const projectId = 'tad-lab-manager-operations-rules-test';

const env = await initializeTestEnvironment({
  projectId,
  firestore: { rules, host: '127.0.0.1', port: 8080 },
});

function staffDb(uid = 'staff-user') {
  return env.authenticatedContext(uid, {
    email: 'eric.carlson.2@bemidjistate.edu',
    email_verified: true,
    firebase: { sign_in_provider: 'password' },
  }).firestore();
}

function anonymousDb(uid = 'student-user') {
  return env.authenticatedContext(uid, {
    firebase: { sign_in_provider: 'anonymous' },
  }).firestore();
}

let failures = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`PASS: ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL: ${name}`);
    console.error(error);
  }
}

try {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'machines', 'test-machine'), {
      name: 'Test Machine',
      room: 'TEST',
      statusHistory: [],
      knowledgeResources: [],
    });
    await setDoc(doc(db, 'reports', 'test-report'), {
      machineId: 'test-machine',
      createdAt: Timestamp.now(),
      urgency: 'Medium',
      usable: 'No',
      issue: 'Test issue',
      attempted: '',
      contact: '',
      resource: '',
      status: 'Open',
      machineNameSnapshot: 'Test Machine',
      roomSnapshot: 'TEST',
      submittedByUid: 'student-user',
      submittedByEmail: '',
    });
  });

  await check('authorized staff can save structured maintenance close-out fields', async () => {
    const db = staffDb();
    await assertSucceeds(updateDoc(doc(db, 'reports', 'test-report'), {
      status: 'Resolved',
      resolutionOutcome: 'Fixed',
      resolutionSummary: 'Replaced the failed component and tested the machine.',
      rootCause: 'Failed component',
      workPerformed: 'Replaced component and calibrated machine',
      helpfulLinks: 'https://example.com/manual',
      safetyProcedureChange: '',
      newRuleGuideline: '',
      followUpDate: '',
      replacementRecommendation: '',
      promoteToKnowledge: true,
      knowledgeTitle: 'Replacing the failed component',
      resolvedBy: 'eric.carlson.2@bemidjistate.edu',
      resolvedAt: serverTimestamp(),
      resolutionUpdatedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }));
  });

  await check('anonymous users cannot change maintenance close-out fields', async () => {
    const db = anonymousDb();
    await assertFails(updateDoc(doc(db, 'reports', 'test-report'), {
      resolutionOutcome: 'Fixed',
      resolutionSummary: 'Unauthorized close-out',
      updatedAt: serverTimestamp(),
    }));
  });

  await check('authorized staff can save machine knowledge and status history', async () => {
    const db = staffDb();
    await assertSucceeds(setDoc(doc(db, 'machines', 'test-machine'), {
      knowledgeResources: [{
        id: 'knowledge-1',
        type: 'Known issue solution',
        title: 'Test solution',
        url: 'https://example.com/manual',
        notes: 'Reusable maintenance notes',
        sourceReportId: 'test-report',
        createdAt: new Date().toISOString(),
        createdBy: 'eric.carlson.2@bemidjistate.edu',
      }],
      statusHistory: [{
        id: 'status-1',
        status: 'Operational',
        note: 'Repair verified',
        reason: 'Report resolved: Fixed',
        changedAt: new Date().toISOString(),
        changedBy: 'eric.carlson.2@bemidjistate.edu',
      }],
      statusNote: 'Repair verified',
      statusUpdatedAt: serverTimestamp(),
      statusUpdatedBy: 'eric.carlson.2@bemidjistate.edu',
    }, { merge: true }));
  });

  await check('anonymous users cannot save machine knowledge or status history', async () => {
    const db = anonymousDb('machine-knowledge-writer');
    await assertFails(setDoc(doc(db, 'machines', 'test-machine'), {
      knowledgeResources: [{ id: 'bad', title: 'Unauthorized' }],
    }, { merge: true }));
  });
} finally {
  await env.cleanup();
}

if (failures) process.exit(1);
console.log('All TAD Lab Manager operations permission tests passed.');
