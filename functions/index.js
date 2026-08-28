const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { onDocumentCreated, onDocumentUpdated } = require('firebase-functions/v2/firestore');
const { defineSecret } = require('firebase-functions/params');

initializeApp();

// Mailjet credentials, sender identity, and stakeholder routing are kept in
// Google Secret Manager, not in public source or machine JSON.
const MAILJET_API_KEY = defineSecret('MAILJET_API_KEY');
const MAILJET_SECRET_KEY = defineSecret('MAILJET_SECRET_KEY');
const MAILJET_SENDER_EMAIL = defineSecret('MAILJET_SENDER_EMAIL');
const MAILJET_STAKEHOLDER_EMAILS = defineSecret('MAILJET_STAKEHOLDER_EMAILS');

// Cost/abuse guardrails. This counts recipient deliveries across both internal
// stakeholder notices and reporter status emails, and stays well below
// Mailjet Free's 200-recipient/day ceiling.
const MAILJET_DAILY_RECIPIENT_LIMIT = 100;
const REPORTER_EMAIL_PER_REPORT_LIMIT = 10;

function clean(value, max = 1200) {
  return String(value ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, max);
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function reporterEmail(value) {
  const text = clean(value, 320);
  if (!text) return '';
  const matches = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
  const unique = [...new Set(matches.map(email => email.toLowerCase()))];
  return unique.length === 1 ? unique[0] : '';
}

function emailList(value) {
  return [...new Set(clean(value, 1600)
    .split(/[;,\s]+/)
    .map(v => v.trim().toLowerCase())
    .filter(validEmail))];
}

function utcDayKey() {
  return new Date().toISOString().slice(0, 10);
}

async function sendMailjet({ to, subject, text }) {
  const apiKey = clean(MAILJET_API_KEY.value(), 500);
  const secretKey = clean(MAILJET_SECRET_KEY.value(), 500);
  const sender = clean(MAILJET_SENDER_EMAIL.value(), 320);
  const recipients = [...new Set((Array.isArray(to) ? to : [to])
    .map(v => clean(v, 320).toLowerCase())
    .filter(validEmail))];

  if (!apiKey || !secretKey || !sender || !validEmail(sender)) {
    throw new Error('Mailjet configuration is incomplete or invalid.');
  }
  if (!recipients.length) {
    throw new Error('No valid email recipients were provided.');
  }

  const authorization = Buffer.from(`${apiKey}:${secretKey}`).toString('base64');
  const response = await fetch('https://api.mailjet.com/v3.1/send', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${authorization}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      Messages: [{
        From: { Email: sender, Name: 'TAD Lab Manager' },
        To: recipients.map(Email => ({ Email })),
        Subject: clean(subject, 240),
        TextPart: String(text ?? '').slice(0, 12000),
      }],
    }),
  });

  if (!response.ok) {
    const detail = clean(await response.text(), 700);
    throw new Error(`Mailjet send failed (${response.status}): ${detail}`);
  }
}

exports.notifyMachineStakeholders = onDocumentCreated({
  document: 'reports/{reportId}',
  region: 'us-central1',
  memory: '256MiB',
  timeoutSeconds: 30,
  minInstances: 0,
  maxInstances: 1,
  concurrency: 1,
  retry: false,
  secrets: [
    MAILJET_API_KEY,
    MAILJET_SECRET_KEY,
    MAILJET_SENDER_EMAIL,
    MAILJET_STAKEHOLDER_EMAILS,
  ],
}, async (event) => {
  const report = event.data?.data();
  if (!report) return;

  const recipients = emailList(MAILJET_STAKEHOLDER_EMAILS.value());
  if (!recipients.length) {
    console.error('No machine stakeholder recipients are configured.');
    return;
  }

  const reportId = event.params.reportId;
  const db = getFirestore();
  const logRef = db.doc(`stakeholderNotificationLog/${reportId}`);
  const dailyRef = db.doc(`emailSafety/mailjet-${utcDayKey()}`);

  const shouldSend = await db.runTransaction(async (tx) => {
    const [existing, daily] = await Promise.all([
      tx.get(logRef),
      tx.get(dailyRef),
    ]);

    if (existing.exists) return false;

    const dailyCount = Number(daily.data()?.count || 0);
    if (dailyCount + recipients.length > MAILJET_DAILY_RECIPIENT_LIMIT) {
      tx.set(logRef, {
        reportId,
        status: 'rate-limited-daily',
        recipientCount: recipients.length,
        updatedAt: FieldValue.serverTimestamp(),
      });
      return false;
    }

    tx.set(logRef, {
      reportId,
      status: 'sending',
      recipientCount: recipients.length,
      updatedAt: FieldValue.serverTimestamp(),
    });
    tx.set(dailyRef, {
      count: FieldValue.increment(recipients.length),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return true;
  });

  if (!shouldSend) return;

  const machine = clean(report.machineNameSnapshot || report.machineId, 200) || 'TAD Lab equipment';
  const room = clean(report.roomSnapshot, 100) || 'Not set';
  const urgency = clean(report.urgency, 40) || 'Not set';
  const usable = clean(report.usable, 40) || 'Not set';
  const issue = clean(report.issue, 1600) || 'No issue description entered';
  const attempted = clean(report.attempted, 1200) || 'None entered';
  const contact = clean(report.contact, 320) || 'Not provided';

  try {
    await sendMailjet({
      to: recipients,
      subject: `[TAD Lab] New maintenance report — ${machine}`,
      text: [
        'A new TAD Lab Manager maintenance report was submitted.',
        '',
        `Machine: ${machine}`,
        `Room: ${room}`,
        `Urgency: ${urgency}`,
        `Usable: ${usable}`,
        `Issue: ${issue}`,
        `Fixes tried: ${attempted}`,
        `Preferred contact: ${contact}`,
        `Report ID: ${reportId}`,
        '',
        'This message is for designated TAD Lab maintenance stakeholders.',
        'Open TAD Lab Manager to review and manage the report.',
      ].join('\n'),
    });

    await logRef.set({
      status: 'sent',
      sentAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  } catch (error) {
    await logRef.set({
      status: 'send-error',
      error: clean(error?.message || error, 700),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    console.error('Machine stakeholder notification send failed', error);
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
  secrets: [MAILJET_API_KEY, MAILJET_SECRET_KEY, MAILJET_SENDER_EMAIL],
}, async (event) => {
  const before = event.data?.before?.data();
  const after = event.data?.after?.data();
  if (!before || !after) return;

  const oldStatus = clean(before.status, 60);
  const newStatus = clean(after.status, 60);
  if (!newStatus || oldStatus === newStatus) return;

  // Privacy boundary: status notices go only to an email the reporter
  // explicitly supplied in Preferred contact. submittedByEmail is never used.
  const to = reporterEmail(after.contact || before.contact);
  if (!to) return;

  const reportId = event.params.reportId;
  const db = getFirestore();
  const eventKey = clean(event.id || `${Date.now()}`, 180).replace(/[^A-Za-z0-9_.-]/g, '_');
  const logRef = db.doc(`reporterStatusNotificationLog/${eventKey}`);
  const dailyRef = db.doc(`emailSafety/mailjet-${utcDayKey()}`);
  const reportLimitRef = db.doc(`reporterStatusEmailCounts/${reportId}`);

  const shouldSend = await db.runTransaction(async (tx) => {
    const [existing, daily, reportCount] = await Promise.all([
      tx.get(logRef),
      tx.get(dailyRef),
      tx.get(reportLimitRef),
    ]);

    if (existing.exists) return false;

    const dailyCount = Number(daily.data()?.count || 0);
    const lifetimeCount = Number(reportCount.data()?.count || 0);

    if (dailyCount + 1 > MAILJET_DAILY_RECIPIENT_LIMIT) {
      tx.set(logRef, {
        reportId,
        status: 'rate-limited-daily',
        reportStatus: newStatus,
        updatedAt: FieldValue.serverTimestamp(),
      });
      return false;
    }

    if (lifetimeCount >= REPORTER_EMAIL_PER_REPORT_LIMIT) {
      tx.set(logRef, {
        reportId,
        status: 'rate-limited-report',
        reportStatus: newStatus,
        updatedAt: FieldValue.serverTimestamp(),
      });
      return false;
    }

    tx.set(logRef, {
      reportId,
      status: 'sending',
      reportStatus: newStatus,
      updatedAt: FieldValue.serverTimestamp(),
    });
    tx.set(dailyRef, {
      count: FieldValue.increment(1),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    tx.set(reportLimitRef, {
      reportId,
      count: FieldValue.increment(1),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return true;
  });

  if (!shouldSend) return;

  const machine = clean(after.machineNameSnapshot || after.machineId, 200) || 'TAD Lab equipment';

  try {
    await sendMailjet({
      to,
      subject: `[TAD Lab] Report status updated — ${machine}`,
      text: [
        'The status of a TAD Lab Manager report you submitted has changed.',
        '',
        `Machine: ${machine}`,
        `Report ID: ${reportId}`,
        `Current status: ${newStatus}`,
        '',
        'This automatic message intentionally includes only the report status. Internal maintenance notes, diagnoses, repair details, costs, safety discussions, resolution details, and manager comments are not included.',
        '',
        'TAD Lab Manager',
      ].join('\n'),
    });

    await logRef.set({
      status: 'sent',
      sentAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  } catch (error) {
    await logRef.set({
      status: 'send-error',
      error: clean(error?.message || error, 700),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    console.error('Reporter status notification send failed', error);
  }
});
