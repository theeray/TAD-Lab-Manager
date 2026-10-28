const { test, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');
const { createService, STAFF, POLICY } = require('../service');
const { createDelivery } = require('../delivery');

if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Tests require the Firestore emulator; no production database may be used.');
const projectId = 'demo-tad-checkout';
const app = initializeApp({ projectId });
const db = getFirestore(app);
let currentTime = '2026-10-28T15:00:00Z';
const clock = () => new Date(currentTime);
let users;
const service = createService({ db, FieldValue, now: clock, auth: { getUser: async uid => users[uid] } });
const request = (uid = 'student', data = {}, verified = true) => ({
  auth: { uid, token: { email: users[uid].email, email_verified: verified, firebase: { sign_in_provider: 'password' } } }, data,
});
const form = (extra = {}) => ({ assetId: 'IPAD-PILOT', requestId: randomUUID(), name: 'Test Student', course: 'Illustration', purpose: 'Class drawing project', dueDate: '2026-10-30', condition: 'Good', notes: '', accessories: ['Case'], agreement: POLICY, ...extra });
async function seed() {
  await service.registerAsset(request('manager', { assetId: 'IPAD-PILOT', assetNumber: '0000024', label: 'Test iPad', model: 'Fictional test fixture' }));
  await service.configure(request('manager', { enabled: true, notificationMode: 'off', spreadsheetId: '' }));
}
const reject = (fn, code) => assert.rejects(fn, error => error.code === code);
beforeEach(async () => {
  currentTime = '2026-10-28T15:00:00Z';
  const response = await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${projectId}/databases/(default)/documents`, { method: 'DELETE' });
  assert.equal(response.ok, true);
  users = {
    student: { uid: 'student', email: 'student@example.test', emailVerified: true },
    other: { uid: 'other', email: 'other@example.test', emailVerified: true },
    manager: { uid: 'manager', email: STAFF[0], emailVerified: true },
  };
  await seed();
});
after(() => deleteApp(app));

test('signed-out and anonymous callers cannot submit', async () => {
  await reject(() => service.submit({ data: form() }), 'unauthenticated');
  const anonymous = request(); anonymous.auth.token.firebase.sign_in_provider = 'anonymous';
  await reject(() => service.submit(anonymous), 'unauthenticated');
});
test('unverified email is rejected even when the form is bypassed', async () => {
  await reject(() => service.submit(request('student', form(), false)), 'failed-precondition');
  assert.equal((await db.collection('checkoutEvents').get()).size, 0);
});
test('a stale verified token cannot override an unverified or disabled account', async () => {
  users.student.emailVerified = false;
  await reject(() => service.submit(request('student', form())), 'failed-precondition');
  users.student.emailVerified = true; users.student.disabled = true;
  await reject(() => service.submit(request('student', form())), 'permission-denied');
});
test('verified checkout records trusted identity, asset snapshot, timestamp and outbox atomically', async () => {
  const result = await service.submit(request('student', form({ borrowerEmail: 'forged@example.test' })));
  const loan = (await db.doc(`checkoutLoans/${result.loanId}`).get()).data();
  assert.equal(loan.borrowerEmail, users.student.email);
  assert.equal(loan.assetNumber, '0000024');
  assert.equal(loan.createdAt instanceof Timestamp, true);
  assert.equal((await db.collection('checkoutEvents').get()).size, 1);
  assert.equal((await db.collection('checkoutOutbox').get()).size, 1);
  assert.equal((await db.doc('checkoutAssets/IPAD-PILOT').get()).data().currentLoanId, result.loanId);
});
test('repeated and simultaneous retries create only one loan and event', async () => {
  const data = form();
  const results = await Promise.all([service.submit(request('student', data)), service.submit(request('student', data))]);
  assert.equal(results[0].loanId, results[1].loanId);
  assert.equal((await db.collection('checkoutEvents').get()).size, 1);
  assert.equal((await db.doc('checkoutCounters/history').get()).data().sequence, 1);
});
test('two students racing for the same iPad produce exactly one successful checkout', async () => {
  const results = await Promise.allSettled([service.submit(request('student', form())), service.submit(request('other', form()))]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.find(r => r.status === 'rejected').reason.code, 'already-exists');
  assert.equal((await db.collection('checkoutEvents').get()).size, 1);
});
test('unknown assets, oversized notes and invalid acknowledgments are denied', async () => {
  await reject(() => service.submit(request('student', form({ assetId: 'UNKNOWN' }))), 'not-found');
  for (const bad of [{ notes: 'a'.repeat(1001) }, { agreement: '' }, { accessories: ['Case', 'Case'] }, { condition: 'Existing damage', notes: '' }]) {
    await reject(() => service.submit(request('student', form(bad))), 'invalid-argument');
  }
});
test('a paused pilot cannot create loans', async () => {
  await service.configure(request('manager', { enabled: false, notificationMode: 'off', spreadsheetId: '' }));
  await reject(() => service.submit(request('student', form())), 'failed-precondition');
});
test('non-managers cannot register assets, configure routing, view dashboard or confirm returns', async () => {
  for (const method of ['registerAsset', 'configure', 'dashboard', 'recordReturn']) {
    await reject(() => service[method](request('student', {})), 'permission-denied');
  }
});
test('unverified manager accounts cannot use manager actions', async () => {
  await reject(() => service.dashboard(request('manager', {}, false)), 'failed-precondition');
});
test('return appends a permanent event and frees asset, without changing the original checkout', async () => {
  const { loanId } = await service.submit(request('student', form()));
  const before = (await db.doc(`checkoutEvents/${loanId}`).get()).data();
  await service.recordReturn(request('manager', { loanId, notes: 'All accessories received.' }));
  await service.recordReturn(request('manager', { loanId, notes: 'Retry after connection loss.' }));
  assert.deepEqual((await db.doc(`checkoutEvents/${loanId}`).get()).data(), before);
  assert.equal((await db.collection('checkoutEvents').get()).size, 2);
  assert.equal((await db.doc(`checkoutEvents/${loanId}-return`).get()).data().returnNotes, 'All accessories received.');
  assert.equal((await db.doc('checkoutAssets/IPAD-PILOT').get()).data().currentLoanId, null);
  await service.submit(request('other', form()));
  assert.equal((await db.collection('checkoutEvents').get()).size, 3);
});
test('students see only their own loan records and ISO timestamp strings', async () => {
  const { loanId } = await service.submit(request('student', form()));
  const own = await service.session(request('student', { assetId: 'IPAD-PILOT' }));
  const other = await service.session(request('other', { assetId: 'IPAD-PILOT' }));
  assert.equal(own.loans[0].id, loanId);
  assert.match(own.loans[0].createdAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(other.loans.length, 0);
  assert.equal('borrowerEmail' in other.asset, false);
});
test('one-iPad registration and fixed spreadsheet destination are enforced', async () => {
  await reject(() => seed(), 'already-exists');
  await service.configure(request('manager', { enabled: true, notificationMode: 'pilot', spreadsheetId: 'a'.repeat(30) }));
  await reject(() => service.configure(request('manager', { enabled: true, notificationMode: 'pilot', spreadsheetId: 'b'.repeat(30) })), 'failed-precondition');
});
test('server daily checkout cap prevents further writes', async () => {
  await db.doc('checkoutDaily/2026-10-28').set({ count: 100 });
  await reject(() => service.submit(request('student', form())), 'resource-exhausted');
});
test('registration rejects short, long, nonnumeric, and ownership-text asset numbers', async () => {
  for (const assetNumber of ['198209', '19820960', '198209X', '198 096', '１９８２０９６', '1982096 PROPERTY OF THE STATE OF MINNESOTA', 1982096]) {
    await reject(() => service.registerAsset(request('manager', {
      assetId: 'NEW-IPAD', assetNumber, assetNumberLength: String(assetNumber).length, label: 'Unregistered iPad',
    })), 'invalid-argument');
  }
  assert.equal((await db.doc('checkoutAssets/NEW-IPAD').get()).exists, false);
});
test('the confirmed test iPad uses asset 1982096 and a separate case label', async () => {
  await db.doc('checkoutAssets/IPAD-PILOT').delete();
  await db.doc('checkoutConfig/pilot').delete();
  await service.registerAsset(request('manager', {
    assetId: 'IPAD-PILOT', assetNumber: '1982096', label: 'Student iPad #07',
  }));
  await service.configure(request('manager', { enabled: true, notificationMode: 'off', spreadsheetId: '' }));
  const { loanId } = await service.submit(request('student', form()));
  assert.equal((await db.doc(`checkoutEvents/${loanId}`).get()).data().assetNumber, '1982096');
  assert.equal((await db.doc(`checkoutEvents/${loanId}`).get()).data().assetLabel, 'Student iPad #07');
});
test('seven-digit asset numbers preserve leading zeros through registration and checkout', async () => {
  await db.doc('checkoutAssets/IPAD-PILOT').delete();
  await db.doc('checkoutConfig/pilot').delete();
  await service.registerAsset(request('manager', {
    assetId: 'IPAD-PILOT', assetNumber: ' 0000024 ', label: 'Leading-zero test iPad',
  }));
  await service.configure(request('manager', { enabled: true, notificationMode: 'off', spreadsheetId: '' }));
  const { loanId } = await service.submit(request('student', form()));
  for (const path of ['checkoutAssets/IPAD-PILOT', `checkoutLoans/${loanId}`, `checkoutEvents/${loanId}`]) {
    assert.equal((await db.doc(path).get()).data().assetNumber, '0000024');
  }
});
test('invalid stored numbers block checkout and enabling without partial loan records', async () => {
  for (const assetNumber of ['198209', '19820960', '198209X', '1982096 PROPERTY OF THE STATE OF MINNESOTA', 1982096]) {
    await db.doc('checkoutAssets/IPAD-PILOT').update({ assetNumber });
    const state = await service.session(request('student', { assetId: 'IPAD-PILOT' }));
    assert.equal(state.asset.assetNumberValid, false);
    await reject(() => service.submit(request('student', form({ assetNumberLength: String(assetNumber).length }))), 'failed-precondition');
    await reject(() => service.configure(request('manager', { enabled: true, notificationMode: 'off', spreadsheetId: '' })), 'failed-precondition');
  }
  for (const collection of ['checkoutLoans', 'checkoutEvents', 'checkoutOutbox']) {
    assert.equal((await db.collection(collection).get()).size, 0);
  }
  await service.configure(request('manager', { enabled: false, notificationMode: 'off', spreadsheetId: '' }));
  assert.equal((await db.doc('checkoutConfig/pilot').get()).data().enabled, false);
});
test('the server fixes every checkout to 56 days and ignores client-supplied dates', async () => {
  const result = await service.submit(request('student', form({ dueDate: '2099-01-01', renewalDueAt: '2099-01-01', cycleStartedAt: '2000-01-01' })));
  const loan = (await db.doc(`checkoutLoans/${result.loanId}`).get()).data();
  assert.equal(loan.cycleStartedAt.toDate().toISOString(), clock().toISOString());
  assert.equal(loan.renewalDueAt.toDate().toISOString(), '2026-12-23T15:00:00.000Z');
  assert.equal(loan.renewalDueAt.toMillis() - loan.cycleStartedAt.toMillis(), 56 * 86400000);
  assert.equal(result.renewalDueAt, '2026-12-23T15:00:00.000Z');
  assert.equal(result.dueDate, '2026-12-23');
});
test('re-checkout is blocked before the boundary and appends a fresh cycle at exactly eight weeks', async () => {
  const first = await service.submit(request('student', form()));
  const original = (await db.doc(`checkoutEvents/${first.loanId}`).get()).data();
  const nextForm = form({ renewLoanId: first.loanId, course: 'Module two', purpose: 'New module project' });
  currentTime = '2026-12-23T14:59:59.999Z';
  await reject(() => service.submit(request('student', nextForm)), 'failed-precondition');
  assert.equal((await db.collection('checkoutEvents').get()).size, 1);
  currentTime = first.renewalDueAt;
  const second = await service.submit(request('student', nextForm));
  const retry = await service.submit(request('student', nextForm));
  assert.equal(retry.alreadySaved, true); assert.equal(retry.loanId, second.loanId);
  assert.equal(second.renewalDueAt, '2027-02-17T15:00:00.000Z');
  assert.deepEqual((await db.doc(`checkoutEvents/${first.loanId}`).get()).data(), original);
  const previous = (await db.doc(`checkoutLoans/${first.loanId}`).get()).data();
  assert.equal(previous.status, 'renewed'); assert.equal(previous.renewedToLoanId, second.loanId);
  const renewed = (await db.doc(`checkoutEvents/${second.loanId}`).get()).data();
  assert.equal(renewed.eventType, 'renewal'); assert.equal(renewed.previousLoanId, first.loanId);
  assert.equal(renewed.course, 'Module two'); assert.equal(renewed.agreement, POLICY);
  assert.equal((await db.collection('checkoutEvents').get()).size, 2);
  assert.equal((await db.collection('checkoutOutbox').get()).size, 2);
  assert.equal((await db.doc('checkoutAssets/IPAD-PILOT').get()).data().currentLoanId, second.loanId);
  await reject(() => service.recordReturn(request('manager', { loanId: first.loanId })), 'failed-precondition');
  await service.recordReturn(request('manager', { loanId: second.loanId }));
  assert.equal((await db.collection('checkoutEvents').get()).size, 3);
});
test('another borrower cannot renew a loan and a returned cycle cannot be reopened', async () => {
  const first = await service.submit(request('student', form()));
  currentTime = first.renewalDueAt;
  await reject(() => service.submit(request('other', form({ renewLoanId: first.loanId }))), 'permission-denied');
  await reject(() => service.submit(request('student', form({ renewLoanId: 'x'.repeat(64) }))), 'invalid-argument');
  await service.recordReturn(request('manager', { loanId: first.loanId }));
  await reject(() => service.submit(request('student', form({ renewLoanId: first.loanId }))), 'failed-precondition');
  assert.equal((await db.collection('checkoutEvents').get()).size, 2);
});
test('simultaneous fresh renewal requests create only one new cycle', async () => {
  const first = await service.submit(request('student', form())); currentTime = first.renewalDueAt;
  const results = await Promise.allSettled([service.submit(request('student', form({ renewLoanId: first.loanId }))), service.submit(request('student', form({ renewLoanId: first.loanId })))]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'rejected').reason.code, 'failed-precondition');
  assert.equal((await db.collection('checkoutEvents').get()).size, 2);
});
test('legacy loan deadlines derive from the saved checkout timestamp and retain renewal protection', async () => {
  const first = await service.submit(request('student', form()));
  const originalStart = Timestamp.fromDate(clock());
  await db.doc(`checkoutLoans/${first.loanId}`).update({ cycleStartedAt: FieldValue.delete(), renewalDueAt: FieldValue.delete(), createdAt: originalStart, dueDate: '2099-01-01' });
  const own = await service.session(request('student'));
  assert.equal(own.loans[0].renewalDueAt, first.renewalDueAt);
  currentTime = '2026-12-23T14:59:59.999Z';
  await reject(() => service.submit(request('student', form({ renewLoanId: first.loanId }))), 'failed-precondition');
  currentTime = first.renewalDueAt;
  await service.submit(request('student', form({ renewLoanId: first.loanId })));
});
test('manager dashboard includes active loans even when their events are outside the latest history window', async () => {
  const first = await service.submit(request('student', form()));
  await db.doc(`checkoutEvents/${first.loanId}`).delete(); // Test an event outside the dashboard window.
  const dashboard = await service.dashboard(request('manager'));
  assert.equal(dashboard.activeLoans[0].id, first.loanId);
  assert.equal(dashboard.activeLoans[0].renewalDueAt, first.renewalDueAt);
});

async function deliveryFixture(options = {}) {
  const { loanId } = await service.submit(request('student', form()));
  const mails = []; const rows = [];
  const delivery = createDelivery({ db, FieldValue, Timestamp, now: clock,
    sendEmail: async mail => mails.push(mail), writeSheet: async (...args) => rows.push(args), ...options });
  return { loanId, mails, rows, delivery };
}
test('delivery waits for configuration without losing the checkout', async () => {
  const f = await deliveryFixture();
  await f.delivery.deliver(f.loanId);
  assert.equal((await db.doc(`checkoutOutbox/${f.loanId}`).get()).data().status, 'awaiting-configuration');
  assert.equal(f.mails.length, 0); assert.equal(f.rows.length, 0);
  assert.equal((await db.collection('checkoutEvents').get()).size, 1);
});
test('pilot sends only Eric and retries do not resend or append duplicate sheet rows', async () => {
  const f = await deliveryFixture();
  await service.configure(request('manager', { enabled: true, notificationMode: 'pilot', spreadsheetId: 'a'.repeat(30) }));
  await f.delivery.deliver(f.loanId); await f.delivery.deliver(f.loanId);
  assert.equal(f.mails.length, 1); assert.deepEqual(f.mails[0].to, [STAFF[0]]);
  assert.equal(f.rows.length, 1); assert.equal(f.rows[0][1], 2);
  assert.equal((await db.doc(`checkoutOutbox/${f.loanId}`).get()).data().status, 'delivered');
});
test('all stakeholder mode uses the fixed four-recipient list', async () => {
  const f = await deliveryFixture();
  await service.configure(request('manager', { enabled: true, notificationMode: 'stakeholders', spreadsheetId: 'a'.repeat(30) }));
  await f.delivery.deliver(f.loanId);
  assert.deepEqual(f.mails[0].to, STAFF);
  assert.equal((await db.doc('checkoutDeliveryBudgets/2026-10-28').get()).data().count, 4);
});
test('a mail failure leaves the loan saved and does not rewrite a successful spreadsheet delivery', async () => {
  let fail = true; let sent = 0; let written = 0;
  const f = await deliveryFixture({ sendEmail: async () => { if (fail) throw new Error('fixture failure'); sent++; }, writeSheet: async () => written++ });
  await service.configure(request('manager', { enabled: true, notificationMode: 'pilot', spreadsheetId: 'a'.repeat(30) }));
  await f.delivery.deliver(f.loanId);
  assert.equal((await db.doc(`checkoutOutbox/${f.loanId}`).get()).data().status, 'failed');
  fail = false; await f.delivery.deliver(f.loanId, { force: true });
  assert.equal(written, 1); assert.equal(sent, 1);
  assert.equal((await db.collection('checkoutEvents').get()).size, 1);
});
test('recipient cap prevents external email attempts', async () => {
  const f = await deliveryFixture();
  await service.configure(request('manager', { enabled: true, notificationMode: 'stakeholders', spreadsheetId: 'a'.repeat(30) }));
  await db.doc('checkoutDeliveryBudgets/2026-10-28').set({ count: 98 });
  await f.delivery.deliver(f.loanId);
  assert.equal(f.mails.length, 0);
  assert.equal((await db.doc(`checkoutOutbox/${f.loanId}`).get()).data().status, 'failed');
});
test('emulator delivery cannot contact mail or spreadsheet services', async () => {
  const f = await deliveryFixture({ emulator: true });
  await service.configure(request('manager', { enabled: true, notificationMode: 'stakeholders', spreadsheetId: 'a'.repeat(30) }));
  await f.delivery.deliver(f.loanId);
  assert.equal(f.mails.length, 0); assert.equal(f.rows.length, 0);
  assert.equal((await db.doc(`checkoutOutbox/${f.loanId}`).get()).data().status, 'emulator');
});
