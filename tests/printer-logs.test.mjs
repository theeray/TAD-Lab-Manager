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
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
  Timestamp,
} from 'firebase/firestore';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rules = fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8');
const projectId = 'tad-lab-manager-printer-log-test';

const env = await initializeTestEnvironment({
  projectId,
  firestore: { rules, host: '127.0.0.1', port: 8080 },
});

function anonymousDb(uid = 'anonymous-printer-user') {
  return env.authenticatedContext(uid, {
    firebase: { sign_in_provider: 'anonymous' },
  }).firestore();
}

function staffDb(uid = 'printer-staff-user') {
  return env.authenticatedContext(uid, {
    email: 'eric.carlson.2@bemidjistate.edu',
    email_verified: true,
    firebase: { sign_in_provider: 'password' },
  }).firestore();
}

async function seed() {
  await env.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'machines', 'print-hp-latex-330'), {
      name: 'HP Latex 330',
      room: 'BN105',
    });
    await setDoc(doc(db, 'printerLogs', 'seed-log'), {
      machineId: 'print-hp-latex-330',
      eventType: 'print',
      eventDate: '2026-09-11',
      notes: 'Seed record',
      createdAt: Timestamp.now(),
      recordedBy: 'eric.carlson.2@bemidjistate.edu',
    });
  });
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
  await seed();

  await check('anonymous users cannot read printer logs', async () => {
    await assertFails(getDoc(doc(anonymousDb(), 'printerLogs', 'seed-log')));
  });

  await check('anonymous users cannot create printer logs', async () => {
    await assertFails(setDoc(doc(anonymousDb(), 'printerLogs', 'anonymous-write'), {
      machineId: 'print-hp-latex-330',
      eventType: 'print',
      eventDate: '2026-09-11',
      notes: '',
      createdAt: serverTimestamp(),
      recordedBy: '',
    }));
  });

  await check('authorized staff can create printer logs', async () => {
    await assertSucceeds(setDoc(doc(staffDb(), 'printerLogs', 'staff-write'), {
      machineId: 'print-hp-latex-330',
      eventType: 'nozzle-check',
      eventDate: '2026-09-11',
      notes: 'Nozzle pattern good',
      createdAt: serverTimestamp(),
      recordedBy: 'eric.carlson.2@bemidjistate.edu',
    }));
  });

  await check('authorized staff can read printer logs', async () => {
    await assertSucceeds(getDoc(doc(staffDb(), 'printerLogs', 'seed-log')));
  });

  await check('printer log must reference an existing machine', async () => {
    await assertFails(setDoc(doc(staffDb(), 'printerLogs', 'bad-machine'), {
      machineId: 'not-a-real-machine',
      eventType: 'print',
      eventDate: '2026-09-11',
      notes: '',
      createdAt: serverTimestamp(),
      recordedBy: 'eric.carlson.2@bemidjistate.edu',
    }));
  });

  await check('printer log entries are immutable', async () => {
    await assertFails(updateDoc(doc(staffDb(), 'printerLogs', 'seed-log'), {
      notes: 'Changed later',
    }));
  });
} finally {
  await env.cleanup();
}

if (failures) process.exit(1);
console.log('All printer-log Firestore permission tests passed.');
