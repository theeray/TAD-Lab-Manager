import { getApp } from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js';
import {
  getAuth,
  signInWithEmailAndPassword
} from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js';

const APPROVED_STAFF = new Set([
  'eric.carlson.2@bemidjistate.edu',
  'chase.cornell@bemidjistate.edu',
  'andrew.graham@bemidjistate.edu',
  'nick.lowery@bemidjistate.edu'
]);

function showToast(message) {
  const toast = document.querySelector('#toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('show');
  window.setTimeout(() => toast.classList.remove('show'), 3200);
}

function normalizeEmail(value = '') {
  return String(value).trim().toLowerCase();
}

async function safeStaffSignIn(event) {
  const button = event.target.closest?.('#staffSignInAction');
  if (!button) return;

  // The main app previously signed out the anonymous reporting user first.
  // That briefly triggered its auth observer, which could sign anonymously back
  // in and overwrite the staff session. Sign in directly instead; Firebase
  // replaces the anonymous session atomically and the main observer then unlocks
  // the staff dashboard.
  event.preventDefault();
  event.stopImmediatePropagation();

  const email = normalizeEmail(document.querySelector('#staffEmail')?.value);
  const password = document.querySelector('#staffPassword')?.value || '';

  if (!APPROVED_STAFF.has(email)) {
    showToast('That email is not on the approved TAD Lab Manager staff list');
    return;
  }
  if (!password) {
    showToast('Enter your TAD Lab Manager password');
    return;
  }

  button.disabled = true;
  const originalText = button.textContent;
  button.textContent = 'Signing in…';

  try {
    const auth = getAuth(getApp());
    const result = await signInWithEmailAndPassword(auth, email, password);

    if (!result.user.emailVerified) {
      showToast('This staff account still needs email verification.');
      return;
    }

    document.querySelector('#modal')?.close();
    showToast('Staff access enabled — dashboard unlocked.');
  } catch (error) {
    console.error('[TAD Lab Manager] Staff sign-in bridge failed', error);
    showToast(error?.code === 'auth/invalid-credential'
      ? 'Email or password was not recognized'
      : 'Staff sign-in was not completed');
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}

document.addEventListener('click', safeStaffSignIn, true);
