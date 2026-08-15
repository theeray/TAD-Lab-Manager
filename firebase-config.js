// Paste the Web App configuration object from Firebase Console > Project settings > Your apps.
// The apiKey in a Firebase web config is not a server secret; access is controlled by Authentication,
// Firestore Security Rules, and (for this release) Firebase App Check.
export const firebaseConfig = {
  apiKey: "PASTE_FIREBASE_API_KEY",
  authDomain: "PASTE_PROJECT.firebaseapp.com",
  projectId: "PASTE_PROJECT_ID",
  storageBucket: "PASTE_PROJECT.firebasestorage.app",
  messagingSenderId: "PASTE_SENDER_ID",
  appId: "PASTE_APP_ID"
};

// Create a score-based reCAPTCHA Enterprise Web key for the deployed site,
// register it under Firebase Console > App Check, and paste that site key here.
// This can be used on the Spark/no-cost plan.
export const appCheckConfig = {
  recaptchaEnterpriseSiteKey: "PASTE_RECAPTCHA_ENTERPRISE_SITE_KEY"
};
