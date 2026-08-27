import { getApp } from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js';
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
const studentSubmitHandler = form?.onsubmit || null;

function toast(message) {
  const el = document.querySelector('#toast');
  if (!el) return;
  el.textContent = message;
  el.classList.add('show');
  window.setTimeout(() => el.classList.remove('show'), 4200);
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
  event.preventDefault();
  const user = auth.currentUser;
  if (!isManagerSession(user)) {
    if (studentSubmitHandler) return studentSubmitHandler.call(form, event);
    return;
  }

  const machineSelect = document.querySelector('#reportMachine');
  const machineId = machineSelect?.value || '';
  const issue = document.querySelector('#issue')?.value.trim() || '';
  if (!machineId) return toast('Please choose a machine');
  if (!issue) return toast('Please describe the issue');

  try {
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
    toast(`Report ${reportRef.id.slice(0, 8)} submitted`);
    window.setTimeout(() => document.querySelector('#nav [data-view="reports"]')?.click(), 250);
  } catch (error) {
    console.error('[TAD Lab Manager] Manager report submission failed', error);
    if (error?.message === 'MACHINE_DATA_UNAVAILABLE' || error?.message === 'MACHINE_NOT_FOUND') {
      toast('The selected machine could not be found in the Firestore or starter inventory.');
      return;
    }
    const code = String(error?.code || 'permission-denied').replace('firestore/', '');
    toast(`Manager report could not be submitted (${code}). The deployed Firestore rules may be out of date.`);
  }
}

onAuthStateChanged(auth, user => {
  if (!form) return;
  form.onsubmit = isManagerSession(user) ? managerSubmit : studentSubmitHandler;
});
