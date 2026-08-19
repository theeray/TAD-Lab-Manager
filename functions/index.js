const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { defineSecret, defineString } = require('firebase-functions/params');
const nodemailer = require('nodemailer');

initializeApp();

const SMTP_PASS = defineSecret('SMTP_PASS');
const SMTP_HOST = defineString('SMTP_HOST', { default: 'smtp.office365.com' });
const SMTP_PORT = defineString('SMTP_PORT', { default: '587' });
const SMTP_USER = defineString('SMTP_USER');
const NOTIFY_TO = defineString('NOTIFY_TO');
const FROM_NAME = defineString('FROM_NAME', { default: 'TAD Lab Manager' });

function clean(value, max = 1200) {
  return String(value ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, max);
}

exports.notifyMaintenanceReport = onDocumentCreated({
  document: 'reports/{reportId}',
  region: 'us-central1',
  memory: '256MiB',
  timeoutSeconds: 30,
  minInstances: 0,
  maxInstances: 1,
  concurrency: 1,
  retry: false,
  secrets: [SMTP_PASS],
}, async (event) => {
  const report = event.data?.data();
  if (!report) return;

  const reportId = event.params.reportId;
  const db = getFirestore();
  const logRef = db.doc(`notificationLog/${reportId}`);

  // Idempotency guard: if this event is delivered more than once, do not send twice.
  const shouldSend = await db.runTransaction(async (tx) => {
    const existing = await tx.get(logRef);
    if (existing.exists && existing.data()?.status === 'sent') return false;
    tx.set(logRef, {
      reportId,
      status: 'sending',
      attempts: FieldValue.increment(1),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return true;
  });
  if (!shouldSend) return;

  const host = SMTP_HOST.value();
  const port = Number(SMTP_PORT.value() || 587);
  const user = SMTP_USER.value();
  const to = NOTIFY_TO.value();
  if (!host || !user || !to) {
    await logRef.set({ status: 'configuration-error', updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    console.error('Notification SMTP settings are incomplete.');
    return;
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass: SMTP_PASS.value() },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });

  const machine = clean(report.machineNameSnapshot || report.machineId, 200);
  const room = clean(report.roomSnapshot, 100);
  const urgency = clean(report.urgency, 30);
  const issue = clean(report.issue, 1600);
  const contact = clean(report.contact, 250) || 'Not provided';

  try {
    const result = await transporter.sendMail({
      from: `"${clean(FROM_NAME.value(), 80)}" <${user}>`,
      to,
      subject: `[TAD Lab] ${urgency || 'New'} report — ${machine}`,
      text: [
        'A new TAD Lab Manager maintenance report was submitted.',
        '',
        `Machine: ${machine}`,
        `Room: ${room || 'Not set'}`,
        `Urgency: ${urgency || 'Not set'}`,
        `Usable: ${clean(report.usable, 30) || 'Not set'}`,
        `Issue: ${issue}`,
        `Fixes tried: ${clean(report.attempted, 1200) || 'None entered'}`,
        `Preferred contact: ${contact}`,
        `Report ID: ${reportId}`,
        '',
        'Open TAD Lab Manager to review and manage the report.'
      ].join('\n')
    });

    await logRef.set({
      status: 'sent',
      messageId: clean(result.messageId, 250),
      sentAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  } catch (error) {
    await logRef.set({
      status: 'send-error',
      error: clean(error?.message || error, 500),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    console.error('Maintenance notification send failed', error);
    // retry:false intentionally prevents an uncontrolled retry storm.
  }
});
