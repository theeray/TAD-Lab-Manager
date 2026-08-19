import './rate-limit.js';
import { getApp } from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js';
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  signInAnonymously
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

function isApprovedStaffUser(user) {
  return !!user?.email && user.emailVerified && APPROVED_STAFF.has(normalizeEmail(user.email));
}

function ensureTopSignOut(auth) {
  const actions = document.querySelector('.top-actions');
  if (!actions) return null;
  let button = document.querySelector('#topSignOut');
  if (!button) {
    button = document.createElement('button');
    button.type = 'button';
    button.id = 'topSignOut';
    button.className = 'btn secondary hidden';
    button.textContent = 'Sign out';
    actions.appendChild(button);
    button.addEventListener('click', async () => {
      button.disabled = true;
      const originalText = button.textContent;
      button.textContent = 'Signing out…';
      try {
        await signOut(auth);
        await signInAnonymously(auth);
        location.hash = '#dashboard';
        showToast('Signed out — student reporting access restored.');
      } catch (error) {
        console.error('[TAD Lab Manager] Staff sign out failed', error);
        showToast('Sign out was not completed');
      } finally {
        button.disabled = false;
        button.textContent = originalText;
      }
    });
  }
  return button;
}

async function safeStaffSignIn(event) {
  const button = event.target.closest?.('#staffSignInAction');
  if (!button) return;

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

const auth = getAuth(getApp());
const topSignOut = ensureTopSignOut(auth);
onAuthStateChanged(auth, user => {
  topSignOut?.classList.toggle('hidden', !isApprovedStaffUser(user));
});
