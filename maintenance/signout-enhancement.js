import { getApps } from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js';
import {
  getAuth,
  onAuthStateChanged,
  signOut,
  signInAnonymously
} from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js';

const APPROVED_STAFF = new Set([
  'eric.carlson.2@bemidjistate.edu',
  'chase.cornell@bemidjistate.edu',
  'andrew.graham@bemidjistate.edu',
  'nick.lowery@bemidjistate.edu'
]);

const app = getApps()[0];
if (app) {
  const auth = getAuth(app);
  const button = document.querySelector('#topSignOut');

  const isStaff = user => !!user?.email && user.emailVerified && APPROVED_STAFF.has(String(user.email).toLowerCase());

  onAuthStateChanged(auth, user => {
    button?.classList.toggle('hidden', !isStaff(user));
  });

  button?.addEventListener('click', async () => {
    button.disabled = true;
    const original = button.textContent;
    button.textContent = 'Signing out…';
    try {
      await signOut(auth);
      await signInAnonymously(auth);
      location.hash = '#dashboard';
    } catch (error) {
      console.error('[TAD Lab Manager] Top-bar sign out failed', error);
      const toast = document.querySelector('#toast');
      if (toast) {
        toast.textContent = 'Sign out was not completed';
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 2500);
      }
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  });
}
