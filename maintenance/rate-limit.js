import { getApp } from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js';
import {
  getFirestore,
  collection,
  doc,
  runTransaction,
  serverTimestamp,
  Timestamp
} from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js';

const USER_DAILY_LIMIT = 10;
const GLOBAL_DAILY_LIMIT = 100;
const APPROVED_STAFF = new Set([
  'eric.carlson.2@bemidjistate.edu',
  'chase.cornell@bemidjistate.edu',
  'andrew.graham@bemidjistate.edu',
  'nick.lowery@bemidjistate.edu'
]);

const app = getApp();
const auth = getAuth(app);
const fs = getFirestore(app);

const normalizeEmail = value => String(value || '').trim().toLowerCase();
const isStaff = user => !!user?.email && user.emailVerified && APPROVED_STAFF.has(normalizeEmail(user.email));

function showToast(message, ms = 4200) {
  const toast = document.querySelector('#toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('show');
  window.setTimeout(() => toast.classList.remove('show'), ms);
}

function utcDayTimestamp() {
  const now = new Date();
  return Timestamp.fromDate(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())));
}

function countForToday(snapshot, day) {
  if (!snapshot.exists()) return 0;
  const data = snapshot.data();
  return data?.day?.toMillis?.() === day.toMillis() ? Number(data.count || 0) : 0;
}

function appendRateLimitNotice() {
  const notice = document.querySelector('#reportForm')?.closest('.card')?.querySelector('.notice');
  if (!notice || notice.dataset.rateLimitAdded) return;
  notice.dataset.rateLimitAdded = 'true';
  notice.insertAdjacentHTML('beforeend', '<br><strong>Abuse protection:</strong> student reporting is limited to 10 reports per anonymous account and 100 reports total per UTC day. Authorized staff are exempt.');
}

async function submitRateLimitedReport(event) {
  if (event.target?.id !== 'reportForm') return;

  const user = auth.currentUser;
  if (!user || isStaff(user)) return;

  event.preventDefault();
  event.stopImmediatePropagation();

  const form = event.target;
  const submitButton = form.querySelector('button[type="submit"]');
  const originalText = submitButton?.textContent || 'Submit report';
  if (submitButton) {
    submitButton.disabled = true;
    submitButton.textContent = 'Submitting…';
  }

  const machineId = document.querySelector('#reportMachine')?.value || '';
  const issue = document.querySelector('#issue')?.value?.trim() || '';
  if (!machineId || !issue) {
    showToast('Choose a machine and describe the issue before submitting.');
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.textContent = originalText;
    }
    return;
  }

  const day = utcDayTimestamp();
  const userCounterRef = doc(fs, 'reportRateUsers', user.uid);
  const globalCounterRef = doc(fs, 'reportRateGlobal', 'reports');
  const machineRef = doc(fs, 'machines', machineId);
  const reportRef = doc(collection(fs, 'reports'));

  try {
    await runTransaction(fs, async tx => {
      const [userCounter, globalCounter, machineSnap] = await Promise.all([
        tx.get(userCounterRef),
        tx.get(globalCounterRef),
        tx.get(machineRef)
      ]);

      if (!machineSnap.exists()) throw new Error('machine-not-configured');

      const userCount = countForToday(userCounter, day);
      const globalCount = countForToday(globalCounter, day);

      if (userCount >= USER_DAILY_LIMIT) throw new Error('user-rate-limit');
      if (globalCount >= GLOBAL_DAILY_LIMIT) throw new Error('global-rate-limit');

      const machineData = machineSnap.data() || {};
      tx.set(userCounterRef, {
        uid: user.uid,
        day,
        count: userCount + 1,
        updatedAt: serverTimestamp()
      });
      tx.set(globalCounterRef, {
        day,
        count: globalCount + 1,
        updatedAt: serverTimestamp()
      });
      tx.set(reportRef, {
        machineId,
        createdAt: serverTimestamp(),
        urgency: document.querySelector('#urgency')?.value || 'Medium',
        usable: document.querySelector('#usable')?.value || 'Yes',
        issue,
        attempted: document.querySelector('#attempted')?.value?.trim() || '',
        contact: document.querySelector('#contact')?.value?.trim() || '',
        resource: document.querySelector('#resource')?.value?.trim() || '',
        status: 'Open',
        machineNameSnapshot: String(machineData.name || machineId),
        roomSnapshot: String(machineData.room || ''),
        submittedByUid: user.uid,
        submittedByEmail: user.email || ''
      });
    });

    form.reset();
    document.querySelector('#reportMachine')?.dispatchEvent(new Event('change', { bubbles: true }));
    showToast(`Report ${reportRef.id.slice(0, 8)} submitted.`);
    document.querySelector('[data-view="dashboard"]')?.click();
  } catch (error) {
    console.error('[TAD Lab Manager] Rate-limited report submission failed', error);
    if (error?.message === 'user-rate-limit') {
      showToast(`This browser has reached the ${USER_DAILY_LIMIT}-report daily limit. Please contact TAD staff if another report is urgent.`);
    } else if (error?.message === 'global-rate-limit') {
      showToast(`TAD Lab Manager has reached its ${GLOBAL_DAILY_LIMIT}-report daily safety limit. Please contact TAD staff directly.`);
    } else if (error?.message === 'machine-not-configured') {
      showToast('That machine is not configured in Firestore yet. Please contact TAD staff.');
    } else {
      showToast('Report could not be submitted. The safety limit or Firestore rules may have blocked it.');
    }
  } finally {
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.textContent = originalText;
    }
  }
}

document.addEventListener('submit', submitRateLimitedReport, true);
appendRateLimitNotice();
