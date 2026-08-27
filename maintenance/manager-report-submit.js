import { getApp } from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js';
import { getFirestore, collection, doc, runTransaction, serverTimestamp } from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js';

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
  window.setTimeout(() => el.classList.remove('show'), 3000);
}

function isManagerSession(user) {
  return !!(user && !user.isAnonymous && user.email && user.emailVerified);
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

  const reportRef = doc(collection(db, 'reports'));
  const machineStatusRef = doc(db, 'machineStatus', machineId);
  const selectedText = machineSelect?.selectedOptions?.[0]?.textContent?.trim() || machineId;

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
    machineNameSnapshot: selectedText,
    roomSnapshot: '',
    submittedByUid: user.uid,
    submittedByEmail: user.email || ''
  };

  try {
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
    toast('Manager report could not be submitted. Firestore rejected the write.');
  }
}

onAuthStateChanged(auth, user => {
  if (!form) return;
  form.onsubmit = isManagerSession(user) ? managerSubmit : studentSubmitHandler;
});
