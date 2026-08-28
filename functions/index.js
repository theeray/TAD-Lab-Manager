const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { onDocumentUpdated } = require('firebase-functions/v2/firestore');
const { defineSecret } = require('firebase-functions/params');

initializeApp();

// Mailjet credentials and sender identity are kept in Google Secret Manager,
// not in source code. The sender address must be verified in Mailjet before
// this function is deployed.
const MAILJET_API_KEY = defineSecret('MAILJET_API_KEY');
const MAILJET_SECRET_KEY = defineSecret('MAILJET_SECRET_KEY');
const MAILJET_SENDER_EMAIL = defineSecret('MAILJET_SENDER_EMAIL');

// Cost/abuse guardrails. These are intentionally far below Mailjet's Free-plan
// ceiling of 200 messages/day.
const REPORTER_EMAIL_DAILY_LIMIT = 50;
const REPORTER_EMAIL_PER_REPORT_LIMIT = 10;

function clean(value, max = 1200) {
  return String(value ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, max);
}

function reporterEmail(value) {
  const text = clean(value, 320);
  if (!text) return '';

  // Preferred contact may contain a name or email. Send only when exactly one
  // conventional email address was explicitly provided there.
  const matches = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
  const unique = [...new Set(matches.map(email => email.toLowerCase()))];
  return unique.length === 1 ? unique[0] : '';
}

function utcDayKey() {
  return new Date().toISOString().slice(0, 10);
}

async function sendMailjetStatus({ to, subject, text }) {
  const apiKey = clean(MAILJET_API_KEY.value(), 500);
  const secretKey = clean(MAILJET_SECRET_KEY.value(), 500);
  const sender = clean(MAILJET_SENDER_EMAIL.value(), 320);

  if (!apiKey || !secretKey || !sender) {
    throw new Error('Mailjet configuration is incomplete.');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(sender)) {
    throw new Error('Mailjet sender address is invalid.');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    throw new Error('Reporter email address is invalid.');
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
        From: {
          Email: sender,
          Name: 'TAD Lab Manager',
        },
        To: [{ Email: to }],
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
  const dailyRef = db.doc(`emailSafety/reporter-${utcDayKey()}`);
  const reportLimitRef = db.doc(`reporterStatusEmailCounts/${reportId}`);

  // One attempt per Firestore event plus conservative daily/per-report limits.
  // Failed attempts still consume the cap by design; this favors cost safety over retries.
  const shouldSend = await db.runTransaction(async (tx) => {
    const [existing, daily, reportCount] = await Promise.all([
      tx.get(logRef),
      tx.get(dailyRef),
      tx.get(reportLimitRef),
    ]);

    if (existing.exists) return false;

    const dailyCount = Number(daily.data()?.count || 0);
    const lifetimeCount = Number(reportCount.data()?.count || 0);

    if (dailyCount >= REPORTER_EMAIL_DAILY_LIMIT) {
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
    await sendMailjetStatus({
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
