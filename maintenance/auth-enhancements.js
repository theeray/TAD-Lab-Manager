import { firebaseConfig } from '../firebase-config.js';
import { getApps, initializeApp } from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js';
import {
  getAuth,
  signInWithEmailAndPassword,
  sendEmailVerification,
  signInAnonymously,
  signOut
} from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js';

const APPROVED_STAFF = new Set([
  'eric.carlson.2@bemidjistate.edu',
  'chase.cornell@bemidjistate.edu',
  'andrew.graham@bemidjistate.edu',
  'nick.lowery@bemidjistate.edu'
]);

const app = getApps()[0] || initializeApp(firebaseConfig);
const auth = getAuth(app);

const normalize = value => String(value || '').trim().toLowerCase();

function setVerificationStatus(message, kind = 'info') {
  const status = document.querySelector('#staffVerificationStatus');
  if (!status) return;
  status.textContent = message;
  status.dataset.kind = kind;
}

async function restoreAnonymousAccess() {
  try {
    await signOut(auth);
    await signInAnonymously(auth);
  } catch (error) {
    console.warn('[TAD Lab Manager] Could not restore anonymous access after verification email action', error);
  }
}

async function resendVerification() {
  const email = normalize(document.querySelector('#staffEmail')?.value);
  const password = document.querySelector('#staffPassword')?.value || '';

  if (!APPROVED_STAFF.has(email)) {
    setVerificationStatus('Enter an approved TAD Lab Manager staff email first.', 'error');
    return;
  }
  if (!password) {
    setVerificationStatus('Enter the TAD Lab Manager password for this account so Firebase can resend verification.', 'error');
    return;
  }

  const button = document.querySelector('#staffResendVerificationAction');
  if (button) button.disabled = true;
  setVerificationStatus('Signing in and requesting a new verification email…');

  try {
    if (auth.currentUser) await signOut(auth);
    const result = await signInWithEmailAndPassword(auth, email, password);

    if (result.user.emailVerified) {
      setVerificationStatus('This email is already verified. Use Sign in to open staff tools.', 'success');
      await restoreAnonymousAccess();
      return;
    }

    await sendEmailVerification(result.user);
    setVerificationStatus('Verification email requested. Check Inbox, Junk, and Spam for mail from noreply@tad-lab-manager.firebaseapp.com.', 'success');
    await restoreAnonymousAccess();
  } catch (error) {
    console.error('[TAD Lab Manager] Resend verification failed', error);
    if (error?.code === 'auth/invalid-credential') {
      setVerificationStatus('The email/password combination was not recognized. Use Reset password if needed.', 'error');
    } else if (error?.code === 'auth/too-many-requests') {
      setVerificationStatus('Firebase temporarily limited verification attempts. Wait a few minutes and try again.', 'error');
    } else {
      setVerificationStatus(`Verification email could not be resent${error?.code ? ` (${error.code})` : ''}.`, 'error');
    }
    await restoreAnonymousAccess();
  } finally {
    if (button) button.disabled = false;
  }
}

function enhanceStaffModal() {
  const createButton = document.querySelector('#staffCreateAction');
  const actions = createButton?.closest('.form-actions');
  if (!actions || document.querySelector('#staffResendVerificationAction')) return;

  const resend = document.createElement('button');
  resend.type = 'button';
  resend.className = 'text-btn';
  resend.id = 'staffResendVerificationAction';
  resend.textContent = 'Resend verification email';
  resend.addEventListener('click', resendVerification);
  actions.appendChild(resend);

  const status = document.createElement('p');
  status.id = 'staffVerificationStatus';
  status.className = 'full row-meta';
  status.textContent = 'If your account was created but no verification email arrived, use “Resend verification email.”';
  actions.insertAdjacentElement('afterend', status);
}

const observer = new MutationObserver(enhanceStaffModal);
observer.observe(document.body, { childList: true, subtree: true });
enhanceStaffModal();
