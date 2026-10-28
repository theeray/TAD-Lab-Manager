import fs from 'node:fs';
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs } from 'firebase/firestore';
const projectId = 'demo-tad-checkout-rules';
const env = await initializeTestEnvironment({ projectId, firestore: { rules: fs.readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'), host: '127.0.0.1', port: 8080 } });
const paths = ['checkoutProfiles/student', 'checkoutAssets/IPAD-PILOT', 'checkoutLoans/loan', 'checkoutEvents/event', 'checkoutOutbox/event', 'checkoutConfig/pilot', 'checkoutBorrowers/student', 'checkoutCounters/history', 'checkoutDaily/day', 'checkoutDeliveryBudgets/day'];
try {
  await env.withSecurityRulesDisabled(async context => {
    for (const path of paths) await setDoc(doc(context.firestore(), path), { borrowerUid: 'student', email: 'private@example.test' });
  });
  for (const [label, db] of [
    ['signed-out', env.unauthenticatedContext().firestore()],
    ['student', env.authenticatedContext('student', { email: 'student@example.test', email_verified: true }).firestore()],
    ['unverified', env.authenticatedContext('unverified', { email_verified: false }).firestore()],
    ['manager', env.authenticatedContext('manager', { email: 'eric.carlson.2@bemidjistate.edu', email_verified: true, firebase: { sign_in_provider: 'password' } }).firestore()],
  ]) {
    for (const path of paths) {
      await assertFails(getDoc(doc(db, path)));
      await assertFails(getDocs(collection(db, path.split('/')[0])));
      await assertFails(setDoc(doc(db, `${path}-new`), { email: 'forged@example.test' }));
      await assertFails(updateDoc(doc(db, path), { email: 'forged@example.test', isAdmin: true }));
      await assertFails(deleteDoc(doc(db, path)));
    }
    console.log(`PASS: ${label} cannot bypass callable checkout authorization or alter permanent history`);
  }
} finally { await env.cleanup(); }
