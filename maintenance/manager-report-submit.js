import { getApp } from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js';
import { getAuth, getIdTokenResult } from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js';
import { getAppCheck, getToken as getAppCheckToken } from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-app-check.js';
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
  setDoc
} from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js';

const APPROVED_STAFF = new Set([
  'eric.carlson.2@bemidjistate.edu',
  'chase.cornell@bemidjistate.edu',
  'andrew.graham@bemidjistate.edu',
  'nick.lowery@bemidjistate.edu'
]);

const app = getApp();
const auth = getAuth(app);
const db = getFirestore(app);
const form = document.querySelector('#reportForm');

function toast(message) {
  const el = document.querySelector('#toast');
  if (!el) return;
  el.textContent = message;
  el.classList.add('show');
  window.setTimeout(() => el.classList.remove('show'), 5200);
}

function isManagerSession(user) {
  return !!(
    user &&
    !user.isAnonymous &&
    user.email &&
    user.emailVerified &&
    APPROVED_STAFF.has(String(user.email).trim().toLowerCase()) &&
    user.providerData?.some(p => p.providerId === 'password')
  );
}

async function verifySecurityContext(user) {
  const tokenResult = await getIdTokenResult(user, true);
  const provider = tokenResult.claims?.firebase?.sign_in_provider || '';
  const emailVerified = tokenResult.claims?.email_verified === true;
  const email = String(tokenResult.claims?.email || user.email || '').trim().toLowerCase();

  console.info('[TAD Lab Manager] Manager auth claims check', {
    email,
    emailVerified,
    signInProvider: provider
  });

  if (provider !== 'password' || !emailVerified || !APPROVED_STAFF.has(email)) {
    const error = new Error('AUTH_CLAIMS_INVALID');
    error.details = { provider, emailVerified, email };
    throw error;
  }

  let appCheckOk = false;
  let appCheckError = null;
  try {
    const appCheck = getAppCheck(app);
    const result = await getAppCheckToken(appCheck, true);
    if (!result?.token) throw new Error('No App Check token returned');
    appCheckOk = true;
    console.info('[TAD Lab Manager] App Check preflight succeeded');
  } catch (cause) {
    appCheckError = cause;
    console.warn('[TAD Lab Manager] App Check preflight failed; continuing because enforcement may still be Monitoring', cause);
  }

  return { appCheckOk, appCheckError };
}

async function ensureMachineRecord(machineId, user) {
  const machineRef = doc(db, 'machines', machineId);
  const existing = await getDoc(machineRef);
  if (existing.exists()) return { id: existing.id, ...existing.data() };

  const response = await fetch('../data/machines.json', { cache: 'no-store' });
  if (!response.ok) throw new Error('MACHINE_DATA_UNAVAILABLE');
  const starterMachines = await response.json();
  const starter = starterMachines.find(machine => machine.id === machineId);
  if (!starter) throw new Error('MACHINE_NOT_FOUND');

  await setDoc(machineRef, {
    ...starter,
    seededAt: serverTimestamp(),
    seededBy: user.email || ''
  });

  return starter;
}

async function managerSubmit(event) {
  const user = auth.currentUser;
  if (!isManagerSession(user)) return;

  const machineSelect = document.querySelector('#reportMachine');
  const machineId = machineSelect?.value || '';
  const issue = document.querySelector('#issue')?.value.trim() || '';
  if (!machineId) return toast('Please choose a machine');
  if (!issue) return toast('Please describe the issue');

  let securityContext = { appCheckOk: false, appCheckError: null };
  try {
    securityContext = await verifySecurityContext(user);
    const machineRecord = await ensureMachineRecord(machineId, user);
    const reportRef = doc(collection(db, 'reports'));
    const machineStatusRef = doc(db, 'machineStatus', machineId);

    const payload = {
      machineId,
      createdAt: serverTimestamp(),
      urgency: document.querySelector('#urgency')?.value || 'Medium',
      usable: document.querySelector('#usable')?.value || 'Yes',
      issue,
      attempted: document.querySelector('#attempted')?.value.trim() || '',
      contact: document.querySelector('#contact')?.value.trim() || '',
      resource: document.querySelector('#resource')?.value.trim() || '',
      status: 'Open',
      machineNameSnapshot: String(machineRecord.name || machineId).slice(0, 250),
      roomSnapshot: String(machineRecord.room || '').slice(0, 250),
      submittedByUid: user.uid,
      submittedByEmail: user.email || ''
    };

    await runTransaction(db, async transaction => {
      const machineStatusSnap = await transaction.get(machineStatusRef);
      transaction.set(reportRef, payload);

      const existingPublicStatus = machineStatusSnap.exists()
        ? machineStatusSnap.data()?.status
        : 'Operational';

      if (!['Attention', 'Out of Service'].includes(existingPublicStatus)) {
        transaction.set(machineStatusRef, {
          machineId,
          status: 'Report Pending',
          pendingReportId: reportRef.id,
          updatedAt: serverTimestamp()
        });
      }
    });

    form.reset();
    toast(securityContext.appCheckOk
      ? `Report ${reportRef.id.slice(0, 8)} submitted`
      : `Report ${reportRef.id.slice(0, 8)} submitted; App Check still needs repair before enforcement.`);
    window.setTimeout(() => document.querySelector('#nav [data-view="reports"]')?.click(), 250);
  } catch (error) {
    console.error('[TAD Lab Manager] Manager report submission failed', error);

    if (error?.message === 'AUTH_CLAIMS_INVALID') {
      const provider = error.details?.provider || 'unknown';
      const verified = error.details?.emailVerified ? 'verified' : 'not verified';
      toast(`Manager authentication token is not acceptable to Firestore (${provider}, ${verified}). Sign out and sign back in.`);
      return;
    }

    if (error?.message === 'MACHINE_DATA_UNAVAILABLE' || error?.message === 'MACHINE_NOT_FOUND') {
      toast('The selected machine could not be found in the Firestore or starter inventory.');
      return;
    }

    const code = String(error?.code || 'permission-denied').replace('firestore/', '');
    if (!securityContext.appCheckOk) {
      const appCheckCode = securityContext.appCheckError?.code || securityContext.appCheckError?.message || 'reCAPTCHA token failed';
      toast(`Firestore rejected the manager transaction (${code}) while App Check is failing (${appCheckCode}). Check Firestore App Check enforcement.`);
      return;
    }
    toast(`Auth and App Check passed, but Firestore rejected the manager transaction (${code}).`);
  }
}

// Intercept only approved manager submissions before the legacy student handler.
// Anonymous/student submissions continue to the existing rate-limited handler unchanged.
form?.addEventListener('submit', event => {
  if (!isManagerSession(auth.currentUser)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  void managerSubmit(event);
}, true);
