const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { onDocumentCreated, onDocumentUpdated } = require('firebase-functions/v2/firestore');
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

function reporterEmail(value) {
  const text = clean(value, 320);
  if (!text) return '';

  // The existing form accepts "Name or email". Only send an automatic
  // status update when exactly one conventional email address can be found.
  const matches = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
  const unique = [...new Set(matches.map(email => email.toLowerCase()))];
  return unique.length === 1 ? unique[0] : '';
}

function mailTransport() {
  const host = SMTP_HOST.value();
  const port = Number(SMTP_PORT.value() || 587);
  const user = SMTP_USER.value();

  if (!host || !user) return null;

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass: SMTP_PASS.value() },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });
}

function senderAddress() {
  const user = SMTP_USER.value();
  return user ? `"${clean(FROM_NAME.value(), 80)}" <${user}>` : '';
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

  const to = NOTIFY_TO.value();
  const transporter = mailTransport();
  const from = senderAddress();
  if (!transporter || !from || !to) {
    await logRef.set({ status: 'configuration-error', updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    console.error('Notification SMTP settings are incomplete.');
    return;
  }

  const machine = clean(report.machineNameSnapshot || report.machineId, 200);
  const room = clean(report.roomSnapshot, 100);
  const urgency = clean(report.urgency, 30);
  const issue = clean(report.issue, 1600);
  const contact = clean(report.contact, 250) || 'Not provided';

  try {
    const result = await transporter.sendMail({
      from,
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

exports.notifyReporterStatus = onDocumentUpdated({
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
  const before = event.data?.before?.data();
  const after = event.data?.after?.data();
  if (!before || !after) return;

  const oldStatus = clean(before.status, 60);
  const newStatus = clean(after.status, 60);
  if (!newStatus || oldStatus === newStatus) return;

  // Privacy boundary: status notices go only to an email the reporter
  // explicitly supplied in Preferred contact. submittedByEmail is not used.
  const to = reporterEmail(after.contact || before.contact);
  if (!to) return;

  const reportId = event.params.reportId;
  const db = getFirestore();
  const eventKey = clean(event.id || `${Date.now()}`, 180).replace(/[^A-Za-z0-9_.-]/g, '_');
  const logRef = db.doc(`reporterStatusNotificationLog/${eventKey}`);

  const shouldSend = await db.runTransaction(async (tx) => {
    const existing = await tx.get(logRef);
    if (existing.exists && existing.data()?.status === 'sent') return false;
    tx.set(logRef, {
      reportId,
      status: 'sending',
      reportStatus: newStatus,
      attempts: FieldValue.increment(1),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return true;
  });
  if (!shouldSend) return;

  const transporter = mailTransport();
  const from = senderAddress();
  if (!transporter || !from) {
    await logRef.set({ status: 'configuration-error', updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    console.error('Reporter status SMTP settings are incomplete.');
    return;
  }

  const machine = clean(after.machineNameSnapshot || after.machineId, 200) || 'TAD Lab equipment';

  try {
    const result = await transporter.sendMail({
      from,
      to,
      subject: `[TAD Lab] Report status updated — ${machine}`,
      text: [
        'The status of a TAD Lab Manager report you submitted has changed.',
        '',
        `Machine: ${machine}`,
        `Report ID: ${reportId}`,
        `Current status: ${newStatus}`,
        '',
        'This automatic message intentionally includes only the report status. Internal maintenance notes, diagnoses, repair details, costs, and manager comments are not included.',
        '',
        'TAD Lab Manager'
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
    console.error('Reporter status notification send failed', error);
  }
});
