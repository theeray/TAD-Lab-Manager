const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getStorage } = require('firebase-admin/storage');
const { onDocumentWritten, onDocumentUpdated } = require('firebase-functions/v2/firestore');
const { defineSecret } = require('firebase-functions/params');
const nodemailer = require('nodemailer');

initializeApp();

// Gmail SMTP credentials and stakeholder routing are kept in Google Secret
// Manager, not in public source or machine JSON. MAILJET_STAKEHOLDER_EMAILS is
// retained as the existing private stakeholder-list secret name so no extra
// secret migration is needed tonight.
const GMAIL_SMTP_USER = defineSecret('GMAIL_SMTP_USER');
const GMAIL_APP_PASSWORD = defineSecret('GMAIL_APP_PASSWORD');
const MAILJET_STAKEHOLDER_EMAILS = defineSecret('MAILJET_STAKEHOLDER_EMAILS');

const REPLY_TO_EMAIL = 'eric.carlson.2@bemidjistate.edu';

// Cost/abuse guardrails. This counts recipient deliveries across both internal
// stakeholder notices and reporter status emails. It remains well below the
// practical daily limits of a personal Gmail account.
const EMAIL_DAILY_RECIPIENT_LIMIT = 100;
const REPORTER_EMAIL_DAILY_LIMIT = 50;
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

async function sendGmail({ to, subject, text, attachments = [] }) {
  const user = clean(GMAIL_SMTP_USER.value(), 320).toLowerCase();
  const appPassword = String(GMAIL_APP_PASSWORD.value() || '').replace(/\s+/g, '');
  const recipients = [...new Set((Array.isArray(to) ? to : [to])
    .map(v => clean(v, 320).toLowerCase())
    .filter(validEmail))];

  if (!user || !validEmail(user) || !appPassword) {
    throw new Error('Gmail SMTP configuration is incomplete or invalid.');
  }
  if (!recipients.length) {
    throw new Error('No valid email recipients were provided.');
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user,
      pass: appPassword,
    },
  });

  await transporter.sendMail({
    from: `TAD Lab Manager <${user}>`,
    replyTo: REPLY_TO_EMAIL,
    to: recipients.join(', '),
    subject: clean(subject, 240),
    text: String(text ?? '').slice(0, 12000),
    attachments: Array.isArray(attachments) ? attachments : [],
  });
}

const STORAGE_BUCKET = 'tad-lab-manager.firebasestorage.app';
const MAX_EMAIL_PHOTO_BYTES = 1572864;

async function loadReportPhotoAttachments(report, reportId) {
  const uid = clean(report?.submittedByUid, 180);
  const expectedPrefix = `reportPhotos/${uid}/${reportId}/`;
  const paths = Array.isArray(report?.photoPaths)
    ? report.photoPaths
        .map(value => clean(value, 500))
        .filter(value => value.startsWith(expectedPrefix))
        .slice(0, 3)
    : [];

  if (!uid || !paths.length) return [];

  const bucket = getStorage().bucket(STORAGE_BUCKET);
  const attachments = [];

  for (const photoPath of paths) {
    try {
      const [buffer] = await bucket.file(photoPath).download();
      if (!buffer?.length || buffer.length > MAX_EMAIL_PHOTO_BYTES) {
        console.warn('Skipping invalid maintenance photo attachment', {
          reportId,
          photoPath,
          bytes: buffer?.length || 0,
        });
        continue;
      }

      attachments.push({
        filename: photoPath.split('/').pop() || 'maintenance-photo.jpg',
        content: buffer,
        contentType: 'image/jpeg',
      });
    } catch (error) {
      console.warn('Could not load maintenance photo attachment', {
        reportId,
        photoPath,
        error: clean(error?.message || error, 300),
      });
    }
  }

  return attachments;
}

exports.notifyMachineStakeholders = onDocumentWritten({
  document: 'reports/{reportId}',
  region: 'us-central1',
  memory: '256MiB',
  timeoutSeconds: 30,
  minInstances: 0,
  maxInstances: 1,
  concurrency: 1,
  retry: false,
  secrets: [
    GMAIL_SMTP_USER,
    GMAIL_APP_PASSWORD,
    MAILJET_STAKEHOLDER_EMAILS,
  ],
}, async (event) => {
  const beforeSnap = event.data?.before;
  const afterSnap = event.data?.after;
  if (!afterSnap?.exists) return;

  const report = afterSnap.data();
  if (!report || report.notificationReady !== true) return;

  // Send once when a new report is immediately ready (no photos), or when
  // photo upload finalization changes notificationReady from false to true.
  if (beforeSnap?.exists && beforeSnap.data()?.notificationReady === true) return;

  const recipients = emailList(MAILJET_STAKEHOLDER_EMAILS.value());
  if (!recipients.length) {
    console.error('No machine stakeholder recipients are configured.');
    return;
  }

  const reportId = event.params.reportId;
  const db = getFirestore();
  const logRef = db.doc(`stakeholderNotificationLog/${reportId}`);
  const dailyRef = db.doc(`emailSafety/gmail-${utcDayKey()}`);

  const shouldSend = await db.runTransaction(async (tx) => {
    const [existing, daily] = await Promise.all([
      tx.get(logRef),
      tx.get(dailyRef),
    ]);

    if (existing.exists) return false;

    const dailyCount = Number(daily.data()?.count || 0);
    if (dailyCount + recipients.length > EMAIL_DAILY_RECIPIENT_LIMIT) {
      tx.set(logRef, {
        reportId,
        status: 'rate-limited-daily',
        provider: 'gmail',
        recipientCount: recipients.length,
        updatedAt: FieldValue.serverTimestamp(),
      });
      return false;
    }

    tx.set(logRef, {
      reportId,
      status: 'sending',
      provider: 'gmail',
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
  const attachments = await loadReportPhotoAttachments(report, reportId);

  try {
    await sendGmail({
      to: recipients,
      attachments,
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
      provider: 'gmail',
      attachmentCount: attachments.length,
      sentAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  } catch (error) {
    await logRef.set({
      status: 'send-error',
      provider: 'gmail',
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
  secrets: [GMAIL_SMTP_USER, GMAIL_APP_PASSWORD],
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
  const dailyRef = db.doc(`emailSafety/gmail-${utcDayKey()}`);
  const reportLimitRef = db.doc(`reporterStatusEmailCounts/${reportId}`);

  const shouldSend = await db.runTransaction(async (tx) => {
    const [existing, daily, reportCount] = await Promise.all([
      tx.get(logRef),
      tx.get(dailyRef),
      tx.get(reportLimitRef),
    ]);

    if (existing.exists) return false;

    const dailyCount = Number(daily.data()?.count || 0);
    const reporterDailyCount = Number(daily.data()?.reporterCount || 0);
    const lifetimeCount = Number(reportCount.data()?.count || 0);

    if (dailyCount + 1 > EMAIL_DAILY_RECIPIENT_LIMIT) {
      tx.set(logRef, {
        reportId,
        status: 'rate-limited-daily',
        provider: 'gmail',
        reportStatus: newStatus,
        updatedAt: FieldValue.serverTimestamp(),
      });
      return false;
    }

    if (reporterDailyCount >= REPORTER_EMAIL_DAILY_LIMIT) {
      tx.set(logRef, {
        reportId,
        status: 'rate-limited-reporter-daily',
        provider: 'gmail',
        reportStatus: newStatus,
        updatedAt: FieldValue.serverTimestamp(),
      });
      return false;
    }

    if (lifetimeCount >= REPORTER_EMAIL_PER_REPORT_LIMIT) {
      tx.set(logRef, {
        reportId,
        status: 'rate-limited-report',
        provider: 'gmail',
        reportStatus: newStatus,
        updatedAt: FieldValue.serverTimestamp(),
      });
      return false;
    }

    tx.set(logRef, {
      reportId,
      status: 'sending',
      provider: 'gmail',
      reportStatus: newStatus,
      updatedAt: FieldValue.serverTimestamp(),
    });
    tx.set(dailyRef, {
      count: FieldValue.increment(1),
      reporterCount: FieldValue.increment(1),
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
    await sendGmail({
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
      provider: 'gmail',
      sentAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  } catch (error) {
    await logRef.set({
      status: 'send-error',
      provider: 'gmail',
      error: clean(error?.message || error, 700),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    console.error('Reporter status notification send failed', error);
  }
});
