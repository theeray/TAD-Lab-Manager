const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { onDocumentCreated, onDocumentUpdated } = require('firebase-functions/v2/firestore');
const { defineSecret, defineString } = require('firebase-functions/params');

initializeApp();

// Microsoft Graph application credentials. The Entra application should be
// granted Mail.Send application permission and scoped to the designated
// TAD Lab Manager sender mailbox whenever the tenant supports that restriction.
const MS_CLIENT_SECRET = defineSecret('MS_CLIENT_SECRET');
const MS_TENANT_ID = defineString('MS_TENANT_ID');
const MS_CLIENT_ID = defineString('MS_CLIENT_ID');
const MS_SENDER = defineString('MS_SENDER');
const NOTIFY_TO = defineString('NOTIFY_TO');

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

function recipientList(value) {
  return clean(value, 1200)
    .split(/[;,]/)
    .map(v => v.trim())
    .filter(Boolean)
    .filter(v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v));
}

async function graphAccessToken() {
  const tenantId = MS_TENANT_ID.value();
  const clientId = MS_CLIENT_ID.value();
  const clientSecret = MS_CLIENT_SECRET.value();

  if (!tenantId || !clientId || !clientSecret) {
    throw new Error('Microsoft Graph application settings are incomplete.');
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  });

  const response = await fetch(
    `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    }
  );

  if (!response.ok) {
    const detail = clean(await response.text(), 500);
    throw new Error(`Microsoft Graph token request failed (${response.status}): ${detail}`);
  }

  const payload = await response.json();
  if (!payload.access_token) throw new Error('Microsoft Graph token response did not include an access token.');
  return payload.access_token;
}

async function sendMail({ to, subject, text }) {
  const sender = clean(MS_SENDER.value(), 320);
  const recipients = Array.isArray(to) ? to : [to];
  const validRecipients = recipients
    .map(v => clean(v, 320))
    .filter(v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v));

  if (!sender || !validRecipients.length) {
    throw new Error('Microsoft Graph sender or recipient settings are incomplete.');
  }

  const token = await graphAccessToken();
  const response = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: {
          subject: clean(subject, 240),
          body: {
            contentType: 'Text',
            content: String(text ?? '').slice(0, 12000),
          },
          toRecipients: validRecipients.map(address => ({
            emailAddress: { address },
          })),
        },
        saveToSentItems: true,
      }),
    }
  );

  if (!response.ok) {
    const detail = clean(await response.text(), 700);
    throw new Error(`Microsoft Graph sendMail failed (${response.status}): ${detail}`);
  }
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
  secrets: [MS_CLIENT_SECRET],
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

  const recipients = recipientList(NOTIFY_TO.value());
  if (!recipients.length) {
    await logRef.set({ status: 'configuration-error', updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    console.error('Internal maintenance notification recipients are not configured.');
    return;
  }

  const machine = clean(report.machineNameSnapshot || report.machineId, 200);
  const room = clean(report.roomSnapshot, 100);
  const urgency = clean(report.urgency, 30);
  const issue = clean(report.issue, 1600);
  const contact = clean(report.contact, 250) || 'Not provided';

  try {
    await sendMail({
      to: recipients,
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
      sentAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  } catch (error) {
    await logRef.set({
      status: 'send-error',
      error: clean(error?.message || error, 700),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    console.error('Maintenance notification send failed', error);
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
  secrets: [MS_CLIENT_SECRET],
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

  const machine = clean(after.machineNameSnapshot || after.machineId, 200) || 'TAD Lab equipment';

  try {
    await sendMail({
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
