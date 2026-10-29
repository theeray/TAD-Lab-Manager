'use strict';
const { createHash } = require('node:crypto');
const { deadline, newDeadline, loanView } = require('./loan-policy');

const STAFF = Object.freeze([
  'eric.carlson.2@bemidjistate.edu',
  'chase.cornell@bemidjistate.edu',
  'andrew.graham@bemidjistate.edu',
  'nick.lowery@bemidjistate.edu',
]);
const BETA_RECIPIENTS = Object.freeze([STAFF[0], STAFF[3]]);
const HISTORY_PAGE_SIZE = 100;
const ACCESSORIES = ['Case', 'Apple Pencil', 'Charging cable', 'Power adapter', 'Keyboard'];
const POLICY = 'ipad-eight-week-v2';
class CheckoutError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
function ensure(ok, code, message) { if (!ok) throw new CheckoutError(code, message); }
function text(value, label, max, min = 0) {
  ensure(typeof value === 'string' && value.trim().length >= min && value.length <= max,
    'invalid-argument', `${label} must contain ${min}–${max} characters.`);
  return value.trim();
}
function id(value) {
  ensure(typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value),
    'invalid-argument', 'Use an asset ID containing letters, numbers, hyphens, or underscores.');
  return value;
}
function validAssetNumber(value) {
  return typeof value === 'string' && value.length === 7 && /^[0-9]{7}$/.test(value);
}
function day(now) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
function serial(doc) {
  if (!doc.exists) return null;
  const encode = value => value && typeof value.toDate === 'function' ? value.toDate().toISOString()
    : Array.isArray(value) ? value.map(encode)
    : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, encode(v)])) : value;
  return encode({ id: doc.id, ...doc.data() });
}
function assetView(doc) {
  if (!doc.exists) return null;
  const a = doc.data();
  return { id: doc.id, assetNumber: a.assetNumber, label: a.label, model: a.model, active: a.active, available: !a.currentLoanId,
    assetNumberValid: validAssetNumber(a.assetNumber) };
}

function createService({ db, auth, FieldValue, now = () => new Date() }) {
  const configRef = db.doc('checkoutConfig/pilot');
  async function identity(request, verified = true) {
    ensure(request.auth?.uid, 'unauthenticated', 'Sign in to TAD Lab Manager.');
    ensure(request.auth.token?.firebase?.sign_in_provider !== 'anonymous', 'unauthenticated', 'Create an account or sign in with your email.');
    const user = await auth.getUser(request.auth.uid);
    ensure(!user.disabled && user.email, 'permission-denied', 'This account cannot check out equipment.');
    if (verified) {
      ensure(request.auth.token?.email_verified === true && user.emailVerified === true && request.auth.token.email === user.email,
        'failed-precondition', 'Verify your email, then choose “I verified my email” before continuing.');
    }
    return { uid: user.uid, email: user.email, verified: user.emailVerified, manager: user.emailVerified && STAFF.includes(user.email.toLowerCase()) };
  }
  async function manager(request) {
    const user = await identity(request);
    ensure(user.manager, 'permission-denied', 'A verified lab manager account is required.');
    return user;
  }
  async function session(request) {
    const user = await identity(request, false);
    const assetId = request.data?.assetId ? id(request.data.assetId) : null;
    const [config, profile, asset, loans, borrower] = await Promise.all([
      configRef.get(), db.doc(`checkoutProfiles/${user.uid}`).get(),
      assetId ? db.doc(`checkoutAssets/${assetId}`).get() : Promise.resolve(null),
      db.collection('checkoutLoans').where('borrowerUid', '==', user.uid).limit(20).get(),
      db.doc(`checkoutBorrowers/${user.uid}`).get(),
    ]);
    const ownLoans = loans.docs.map(doc => loanView(serial(doc)));
    const activeId = borrower.data()?.currentLoanId;
    if (activeId && !ownLoans.some(loan => loan.id === activeId)) {
      const active = await db.doc(`checkoutLoans/${activeId}`).get();
      if (active.exists && active.data().borrowerUid === user.uid) ownLoans.push(loanView(serial(active)));
    }
    const serverNow = now();
    return { user, profile: profile.data() || {}, asset: asset ? assetView(asset) : null,
      serverNow: serverNow.toISOString(), checkoutDueAt: newDeadline(serverNow).toISOString(),
      enabled: config.data()?.enabled === true, loans: ownLoans };
  }
  async function submit(request) {
    const user = await identity(request);
    const d = request.data || {};
    const assetId = id(d.assetId);
    const requestId = text(d.requestId, 'Request ID', 64, 20);
    ensure(/^[A-Za-z0-9_-]+$/.test(requestId), 'invalid-argument', 'Invalid request ID.');
    const name = text(d.name, 'Name', 100, 2);
    const course = text(d.course, 'Course or project', 150, 2);
    const purpose = text(d.purpose, 'Purpose', 500, 2);
    const notes = text(d.notes ?? '', 'Condition notes', 1000);
    ensure(['Good', 'Existing damage'].includes(d.condition), 'invalid-argument', 'Select the current condition.');
    ensure(d.condition !== 'Existing damage' || notes.length >= 3, 'invalid-argument', 'Describe the existing damage.');
    ensure(Array.isArray(d.accessories) && d.accessories.length <= ACCESSORIES.length &&
      new Set(d.accessories).size === d.accessories.length && d.accessories.every(v => ACCESSORIES.includes(v)), 'invalid-argument', 'Select the included accessories.');
    ensure(d.agreement === POLICY, 'invalid-argument', 'Accept the checkout acknowledgment.');
    const cycleStartedAt = now();
    const renewalDueAt = newDeadline(cycleStartedAt);
    const due = day(renewalDueAt);
    const previousLoanId = d.renewLoanId || null;
    ensure(previousLoanId === null || (typeof previousLoanId === 'string' && /^[a-f0-9]{64}$/.test(previousLoanId)),
      'invalid-argument', 'Invalid previous loan ID.');
    const hash = createHash('sha256').update(`${user.uid}:${requestId}`).digest('hex');
    const loanRef = db.doc(`checkoutLoans/${hash}`);
    const assetRef = db.doc(`checkoutAssets/${assetId}`);
    const borrowerRef = db.doc(`checkoutBorrowers/${user.uid}`);
    const counterRef = db.doc('checkoutCounters/history');
    const dailyRef = db.doc(`checkoutDaily/${day(cycleStartedAt)}`);
    return db.runTransaction(async tx => {
      const [old, cfg, asset, borrower, counter, daily, previous] = await Promise.all([
        tx.get(loanRef), tx.get(configRef), tx.get(assetRef), tx.get(borrowerRef), tx.get(counterRef), tx.get(dailyRef),
        previousLoanId ? tx.get(db.doc(`checkoutLoans/${previousLoanId}`)) : Promise.resolve(null),
      ]);
      if (old.exists) return { loanId: old.id, alreadySaved: true, dueDate: old.data().dueDate, renewalDueAt: deadline(old.data())?.toISOString() || null };
      ensure(cfg.data()?.enabled === true, 'failed-precondition', 'The pilot is not accepting checkouts yet.');
      ensure(asset.exists && asset.data().active === true && cfg.data().pilotAssetId === assetId,
        'not-found', 'This iPad is not registered for the pilot. Ask a lab manager.');
      ensure(validAssetNumber(asset.data().assetNumber),
        'failed-precondition', 'The university asset number must contain exactly 7 digits. Ask a lab manager to verify the asset label.');
      if (previousLoanId) {
        const prior = previous?.data();
        ensure(prior?.borrowerUid === user.uid && prior.assetId === assetId,
          'permission-denied', 'You can only re-check out your own current iPad.');
        ensure(prior.status === 'checked-out' && asset.data().currentLoanId === previousLoanId && borrower.data()?.currentLoanId === previousLoanId,
          'failed-precondition', 'This loan is no longer active. Refresh your history.');
        const priorDeadline = deadline(prior);
        ensure(priorDeadline && cycleStartedAt >= priorDeadline, 'failed-precondition', 'Re-checkout is available once the eight-week period has ended.');
      } else {
        ensure(!asset.data().currentLoanId, 'already-exists', 'This iPad is already checked out.');
        ensure(!borrower.data()?.currentLoanId, 'already-exists', 'You already have an active equipment loan.');
      }
      ensure((daily.data()?.count || 0) < 100, 'resource-exhausted', 'The daily pilot checkout limit has been reached. Contact a lab manager.');
      const sequence = (counter.data()?.sequence || 0) + 1;
      const createdAt = FieldValue.serverTimestamp();
      const loan = { assetId, assetNumber: asset.data().assetNumber, assetLabel: asset.data().label,
        borrowerUid: user.uid, borrowerEmail: user.email, borrowerName: name, course, purpose,
        dueDate: due, cycleStartedAt, renewalDueAt, previousLoanId, condition: d.condition, notes, accessories: d.accessories, agreement: POLICY,
        createdAt, status: 'checked-out' };
      const event = { ...loan, loanId: hash, eventType: previousLoanId ? 'renewal' : 'checkout', sequence, recordedBy: user.email };
      if (previousLoanId) tx.update(previous.ref, { status: 'renewed', renewedAt: createdAt, renewedBy: user.email, renewedToLoanId: hash });
      tx.create(loanRef, loan);
      tx.create(db.doc(`checkoutEvents/${hash}`), event);
      tx.create(db.doc(`checkoutOutbox/${hash}`), { eventId: hash, status: 'pending', attempts: 0, createdAt });
      tx.set(assetRef, { currentLoanId: hash, updatedAt: createdAt }, { merge: true });
      tx.set(borrowerRef, { currentLoanId: hash }, { merge: true });
      tx.set(db.doc(`checkoutProfiles/${user.uid}`), { name, email: user.email, updatedAt: createdAt });
      tx.set(counterRef, { sequence });
      tx.set(dailyRef, { count: (daily.data()?.count || 0) + 1 });
      return { loanId: hash, alreadySaved: false, dueDate: due, renewalDueAt: renewalDueAt.toISOString() };
    });
  }
  async function recordReturn(request) {
    const staff = await manager(request);
    const loanId = text(request.data?.loanId, 'Loan ID', 64, 64);
    ensure(/^[a-f0-9]{64}$/.test(loanId), 'invalid-argument', 'Invalid loan ID.');
    const notes = text(request.data?.notes ?? '', 'Return notes', 1000);
    const loanRef = db.doc(`checkoutLoans/${loanId}`);
    const eventId = `${loanId}-return`;
    const counterRef = db.doc('checkoutCounters/history');
    return db.runTransaction(async tx => {
      const [loan, counter] = await Promise.all([tx.get(loanRef), tx.get(counterRef)]);
      ensure(loan.exists, 'not-found', 'Loan not found.');
      if (loan.data().status === 'returned') return { alreadySaved: true };
      const data = loan.data();
      ensure(data.status === 'checked-out', 'failed-precondition', 'Only the current loan can be returned. Refresh your history.');
      const [asset, borrower] = await Promise.all([
        tx.get(db.doc(`checkoutAssets/${data.assetId}`)), tx.get(db.doc(`checkoutBorrowers/${data.borrowerUid}`)),
      ]);
      ensure(asset.data()?.currentLoanId === loanId && borrower.data()?.currentLoanId === loanId,
        'failed-precondition', 'The active loan does not match this asset. Contact the app administrator.');
      const createdAt = FieldValue.serverTimestamp();
      const sequence = (counter.data()?.sequence || 0) + 1;
      tx.update(loanRef, { status: 'returned', returnedAt: createdAt, returnedBy: staff.email, returnNotes: notes });
      tx.create(db.doc(`checkoutEvents/${eventId}`), { ...data, createdAt, checkoutAt: data.createdAt,
        status: 'returned', eventType: 'return', loanId, sequence, recordedBy: staff.email, returnNotes: notes });
      tx.create(db.doc(`checkoutOutbox/${eventId}`), { eventId, status: 'pending', attempts: 0, createdAt });
      tx.update(asset.ref, { currentLoanId: null, updatedAt: createdAt });
      tx.update(borrower.ref, { currentLoanId: null });
      tx.set(counterRef, { sequence });
      return { alreadySaved: false };
    });
  }
  function configView(data = {}) {
    return { pilotAssetId: data.pilotAssetId || null, enabled: data.enabled === true,
      notificationMode: data.notificationMode === 'pilot' ? 'beta' : data.notificationMode || 'beta' };
  }
  async function historyPage(data = {}) {
    const cursor = data.beforeSequence;
    ensure(cursor === undefined || cursor === null || (Number.isSafeInteger(cursor) && cursor > 0),
      'invalid-argument', 'Use a valid history cursor.');
    let query = db.collection('checkoutEvents').orderBy('sequence', 'desc');
    if (cursor != null) query = query.startAfter(cursor);
    const snapshot = await query.limit(HISTORY_PAGE_SIZE + 1).get();
    const page = snapshot.docs.slice(0, HISTORY_PAGE_SIZE);
    const jobs = page.length ? await db.getAll(...page.map(doc => db.doc(`checkoutOutbox/${doc.id}`))) : [];
    const hasMore = snapshot.size > HISTORY_PAGE_SIZE;
    return { events: page.map(doc => loanView(serial(doc))), outbox: jobs.filter(doc => doc.exists).map(serial),
      hasMore, nextSequence: hasMore ? page.at(-1).data().sequence : null };
  }
  async function history(request) {
    await manager(request);
    return historyPage(request.data || {});
  }
  async function dashboard(request) {
    await manager(request);
    const [cfg, assets, page] = await Promise.all([
      configRef.get(), db.collection('checkoutAssets').limit(10).get(), historyPage(),
    ]);
    const activeIds = [...new Set(assets.docs.map(doc => doc.data().currentLoanId).filter(Boolean))];
    const activeLoans = await Promise.all(activeIds.map(async loanId => loanView(serial(await db.doc(`checkoutLoans/${loanId}`).get()) || {})));
    return { serverNow: now().toISOString(), activeLoans: activeLoans.filter(loan => loan.id), config: configView(cfg.data()),
      assets: assets.docs.map(serial), ...page, recipients: STAFF, betaRecipients: BETA_RECIPIENTS };
  }
  async function registerAsset(request) {
    const staff = await manager(request);
    const d = request.data || {};
    const assetId = id(d.assetId);
    const assetNumber = text(d.assetNumber, 'Asset number', 80, 1);
    ensure(validAssetNumber(assetNumber), 'invalid-argument',
      'University asset number must contain exactly 7 digits. Do not include “PROPERTY OF THE STATE OF MINNESOTA”.');
    const asset = { assetNumber, label: text(d.label, 'iPad label', 100, 2),
      model: text(d.model ?? '', 'Model', 100), active: true, currentLoanId: null,
      createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), registeredBy: staff.email };
    return db.runTransaction(async tx => {
      const cfg = await tx.get(configRef);
      ensure(!cfg.data()?.pilotAssetId, 'already-exists', 'The one-iPad pilot already has an asset registered.');
      tx.create(db.doc(`checkoutAssets/${assetId}`), asset);
      tx.set(configRef, { pilotAssetId: assetId, enabled: false, notificationMode: 'beta',
        createdAt: FieldValue.serverTimestamp() });
      return { assetId };
    });
  }
  async function configure(request) {
    const staff = await manager(request);
    const d = request.data || {};
    ensure(typeof d.enabled === 'boolean' && ['off', 'beta', 'stakeholders'].includes(d.notificationMode),
      'invalid-argument', 'Choose valid pilot and notification settings.');
    return db.runTransaction(async tx => {
      const cfg = await tx.get(configRef);
      ensure(cfg.data()?.pilotAssetId, 'failed-precondition', 'Register the pilot iPad first.');
      if (d.enabled) {
        const asset = await tx.get(db.doc(`checkoutAssets/${cfg.data().pilotAssetId}`));
        ensure(asset.exists && validAssetNumber(asset.data().assetNumber),
          'failed-precondition', 'Verify the 7-digit university asset number before enabling checkouts.');
      }
      tx.set(configRef, { enabled: d.enabled, notificationMode: d.notificationMode,
        updatedAt: FieldValue.serverTimestamp(), updatedBy: staff.email }, { merge: true });
      return { saved: true };
    });
  }
  return { session, submit, recordReturn, dashboard, history, registerAsset, configure, manager };
}
module.exports = { createService, CheckoutError, STAFF, BETA_RECIPIENTS, HISTORY_PAGE_SIZE, POLICY, ACCESSORIES, day };
