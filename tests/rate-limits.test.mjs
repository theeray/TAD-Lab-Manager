import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
} from 'firebase/firestore';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rules = fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8');
const projectId = 'tad-lab-manager-rules-test';

const env = await initializeTestEnvironment({
  projectId,
  firestore: { rules, host: '127.0.0.1', port: 8080 },
});

function utcDayTimestamp() {
  const now = new Date();
  return Timestamp.fromDate(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())));
}

function anonymousDb(uid) {
  return env.authenticatedContext(uid, {
    firebase: { sign_in_provider: 'anonymous' },
  }).firestore();
}

function staffDb(uid = 'staff-user') {
  return env.authenticatedContext(uid, {
    email: 'eric.carlson.2@bemidjistate.edu',
    email_verified: true,
    firebase: { sign_in_provider: 'password' },
  }).firestore();
}

async function seedBase() {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();

    await setDoc(doc(db, 'machines', 'test-machine'), {
      name: 'Test Machine',
      room: 'TEST',
    });

    await setDoc(doc(db, 'materials', 'test-acrylic'), {
      name: 'Test Acrylic',
      method: 'sqin',
      rate: 0.025,
      finishGroup: 'sheet',
      active: true,
      demo: false,
      updatedAt: Timestamp.now(),
      updatedBy: 'eric.carlson.2@bemidjistate.edu',
    });

    await setDoc(doc(db, 'pricingConfig', 'sheetMetalTiers'), {
      tiers: [{ max: 36, total: 3 }],
      updatedAt: Timestamp.now(),
      updatedBy: 'eric.carlson.2@bemidjistate.edu',
    });
  });
}

async function submit(db, uid) {
  const day = utcDayTimestamp();
  const userCounterRef = doc(db, 'reportRateUsers', uid);
  const globalCounterRef = doc(db, 'reportRateGlobal', 'reports');
  const reportRef = doc(collection(db, 'reports'));

  return runTransaction(db, async (tx) => {
    const [userCounter, globalCounter] = await Promise.all([
      tx.get(userCounterRef),
      tx.get(globalCounterRef),
    ]);
    const sameDay = (snap) => snap.exists() && snap.data()?.day?.toMillis?.() === day.toMillis();
    const userCount = sameDay(userCounter) ? Number(userCounter.data().count || 0) : 0;
    const globalCount = sameDay(globalCounter) ? Number(globalCounter.data().count || 0) : 0;

    tx.set(userCounterRef, { uid, day, count: userCount + 1, updatedAt: serverTimestamp() });
    tx.set(globalCounterRef, { day, count: globalCount + 1, updatedAt: serverTimestamp() });
    tx.set(reportRef, {
      machineId: 'test-machine',
      createdAt: serverTimestamp(),
      urgency: 'Medium',
      usable: 'Yes',
      issue: 'Automated rules test',
      attempted: '',
      contact: '',
      resource: '',
      status: 'Open',
      machineNameSnapshot: 'Test Machine',
      roomSnapshot: 'TEST',
      submittedByUid: uid,
      submittedByEmail: '',
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
  await seedBase();

  await check('anonymous report without rate counters is denied', async () => {
    const uid = 'direct-write-user';
    const db = anonymousDb(uid);
    await assertFails(setDoc(doc(collection(db, 'reports')), {
      machineId: 'test-machine',
      createdAt: serverTimestamp(),
      urgency: 'Medium',
      usable: 'Yes',
      issue: 'Bypass attempt',
      attempted: '',
      contact: '',
      resource: '',
      status: 'Open',
      machineNameSnapshot: 'Test Machine',
      roomSnapshot: 'TEST',
      submittedByUid: uid,
      submittedByEmail: '',
    }));
  });

  await check('first 10 reports from one anonymous UID are allowed', async () => {
    const uid = 'ten-report-user';
    const db = anonymousDb(uid);
    for (let i = 0; i < 10; i += 1) await assertSucceeds(submit(db, uid));
    const counter = await assertSucceeds(getDoc(doc(db, 'reportRateUsers', uid)));
    if (counter.data().count !== 10) throw new Error(`Expected user count 10, got ${counter.data().count}`);
  });

  await check('11th report from the same anonymous UID is denied', async () => {
    const uid = 'ten-report-user';
    const db = anonymousDb(uid);
    await assertFails(submit(db, uid));
  });

  await check('anonymous users can read shared materials', async () => {
    const db = anonymousDb('material-reader');
    await assertSucceeds(
      getDoc(doc(db, 'materials', 'test-acrylic'))
    );
  });

  await check('anonymous users cannot change shared materials', async () => {
    const db = anonymousDb('material-writer');

    await assertFails(
      setDoc(doc(db, 'materials', 'anonymous-material'), {
        name: 'Unauthorized Material',
        method: 'sqin',
        rate: 0.01,
        finishGroup: 'sheet',
        active: true,
        demo: false,
        updatedAt: serverTimestamp(),
        updatedBy: '',
      })
    );
  });

  await check('authorized staff can change shared materials', async () => {
    const db = staffDb();

    await assertSucceeds(
      setDoc(doc(db, 'materials', 'staff-material'), {
        name: 'Staff Material',
        method: 'sqin',
        rate: 0.02,
        finishGroup: 'sheet',
        active: true,
        demo: false,
        updatedAt: serverTimestamp(),
        updatedBy: 'eric.carlson.2@bemidjistate.edu',
      })
    );
  });

  await check('anonymous users can read shared pricing configuration', async () => {
    const db = anonymousDb('pricing-reader');
    await assertSucceeds(
      getDoc(doc(db, 'pricingConfig', 'sheetMetalTiers'))
    );
  });

  await check('anonymous users cannot add machines', async () => {
    const db = anonymousDb('machine-writer');

    await assertFails(
      setDoc(doc(db, 'machines', 'unauthorized-machine'), {
        name: 'Unauthorized Machine',
        room: 'TEST',
      })
    );
  });

  await check('anonymous users cannot add repair or cost records', async () => {
    const db = anonymousDb('repair-writer');

    await assertFails(
      setDoc(doc(db, 'repairs', 'unauthorized-repair'), {
        machineId: 'test-machine',
        resolution: 'Unauthorized repair',
        partsCost: 999,
      })
    );
  });

  await check('global 100th report is allowed and 101st is denied', async () => {
    await env.clearFirestore();
    await seedBase();
    const day = utcDayTimestamp();
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'reportRateGlobal', 'reports'), {
        day,
        count: 99,
        updatedAt: Timestamp.now(),
      });
    });

    const db100 = anonymousDb('global-user-100');
    await assertSucceeds(submit(db100, 'global-user-100'));

    const db101 = anonymousDb('global-user-101');
    await assertFails(submit(db101, 'global-user-101'));
  });
} finally {
  await env.cleanup();
}

if (failures) process.exit(1);
console.log('All TAD Lab Manager Firestore rate-limit tests passed.');
