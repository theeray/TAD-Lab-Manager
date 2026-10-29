'use strict';
const { randomUUID } = require('node:crypto');
const { STAFF, BETA_RECIPIENTS, day } = require('./service');

function iso(value) { return value?.toDate ? value.toDate().toISOString() : String(value || ''); }
function message(eventId, e) {
  return {
    subject: `[TAD Checkout] ${e.eventType === 'return' ? 'Returned' : e.eventType === 'renewal' ? 'Re-checked out' : 'Checked out'}: ${e.assetLabel} (${e.assetNumber})`,
    messageId: `<tad-checkout-${eventId}@tad-lab-manager.web.app>`,
    text: [
      `Equipment ${e.eventType === 'return' ? 'return confirmed by a lab manager' : e.eventType === 'renewal' ? 're-checkout recorded for a new eight-week module' : 'checkout recorded'}.`, '',
      `iPad: ${e.assetLabel}`, `Asset number: ${e.assetNumber}`,
      `Recorded at: ${iso(e.createdAt)}`,
      `Return or re-checkout by: ${e.dueDate}`, `Loan ID: ${e.loanId}`, '',
      'Open the manager history for the complete record:',
      'https://tad-lab-manager.web.app/equipment-checkout.html#manager',
    ].join('\n'),
  };
}

function createDelivery({ db, FieldValue, Timestamp, sendEmail, now = () => new Date(), emulator = false }) {
  async function deliver(eventId, { force = false } = {}) {
    const jobRef = db.doc(`checkoutOutbox/${eventId}`);
    const lease = randomUUID();
    const locked = await db.runTransaction(async tx => {
      const snap = await tx.get(jobRef);
      if (!snap.exists) return false;
      const job = snap.data();
      if (job.status === 'delivered' || (job.leaseUntil?.toMillis() > now().getTime())) return false;
      if (!force && ((job.attempts || 0) >= 10 || job.nextAttemptAt?.toMillis() > now().getTime())) return false;
      tx.update(jobRef, { status: 'processing', lease, leaseUntil: Timestamp.fromMillis(now().getTime() + 300000),
        attempts: force ? 1 : (job.attempts || 0) + 1, updatedAt: FieldValue.serverTimestamp() });
      return true;
    });
    if (!locked) return;
    const finish = patch => jobRef.update({ ...patch, leaseUntil: Timestamp.fromMillis(0), updatedAt: FieldValue.serverTimestamp() });
    if (emulator) {
      await finish({ status: 'emulator', lastError: 'Local test: external email delivery is disabled.' });
      return;
    }
    try {
      const [jobSnap, eventSnap, cfgSnap] = await Promise.all([
        jobRef.get(), db.doc(`checkoutEvents/${eventId}`).get(), db.doc('checkoutConfig/pilot').get(),
      ]);
      const job = jobSnap.data();
      const event = eventSnap.data();
      if (!event) throw new Error('The permanent event record is missing.');
      const cfg = cfgSnap.data() || {};
      let emailSent = !!job.emailSent;
      if (!emailSent && cfg.notificationMode === 'off') {
        await finish({ status: 'notifications-off', lastError: '' });
        return;
      }
      if (['beta', 'pilot', 'stakeholders'].includes(cfg.notificationMode) && !emailSent) {
        const to = cfg.notificationMode === 'stakeholders' ? [...STAFF] : [...BETA_RECIPIENTS];
        // Count recipient deliveries, not messages. Failed/uncertain attempts also consume this budget.
        const budgetRef = db.doc(`checkoutDeliveryBudgets/${day(now())}`);
        await db.runTransaction(async tx => {
          const budget = await tx.get(budgetRef);
          const count = budget.data()?.count || 0;
          if (count + to.length > 100) throw new Error('The 100-recipient daily checkout email budget has been reached.');
          tx.set(budgetRef, { count: count + to.length, updatedAt: FieldValue.serverTimestamp() });
        });
        await sendEmail({ to, ...message(eventId, event) });
        await jobRef.update({ emailSent: true, emailMode: cfg.notificationMode === 'pilot' ? 'beta' : cfg.notificationMode, emailRecipients: to, emailSentAt: FieldValue.serverTimestamp() });
        emailSent = true;
      }
      await finish({ status: emailSent ? 'delivered' : 'awaiting-configuration', lastError: '',
        nextAttemptAt: Timestamp.fromMillis(now().getTime() + 1800000) });
    } catch (error) {
      // Keep credentials/provider responses out of manager-visible errors and logs.
      await finish({ status: 'failed', lastError: 'Delivery failed. The checkout is saved; check email settings and daily limits, then retry.',
        nextAttemptAt: Timestamp.fromMillis(now().getTime() + 1800000) });
      console.error('Checkout delivery failed', { eventId, code: error.code || 'delivery-error' });
    }
  }
  async function retryPending({ force = false } = {}) {
    const jobs = await db.collection('checkoutOutbox')
      .where('status', 'in', ['pending', 'failed', 'awaiting-configuration', 'processing']).limit(20).get();
    for (const job of jobs.docs) await deliver(job.id, { force });
    return { examined: jobs.size };
  }
  return { deliver, retryPending };
}
module.exports = { createDelivery, message };
