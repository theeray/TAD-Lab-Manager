import { firebaseConfig, appCheckConfig } from '../firebase-config.js?v=20260819-2';

import {
  getApps,
  initializeApp
} from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js';

import {
  getAuth,
  onAuthStateChanged,
  signInAnonymously
} from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js';

import {
  getFirestore,
  collection,
  doc,
  getDocs,
  onSnapshot,
  setDoc,
  deleteDoc,
  writeBatch,
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js';

import {
  initializeAppCheck,
  ReCaptchaV3Provider
} from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-app-check.js';

const CURRENT_PRICING_EDITORS = new Set([
  'eric.carlson.2@bemidjistate.edu',
  'chase.cornell@bemidjistate.edu',
  'andrew.graham@bemidjistate.edu',
  'nick.lowery@bemidjistate.edu'
]);

const ui = window.TADSharedPricingUI;

if (!ui) {
  throw new Error('TAD shared-pricing UI bridge was not initialized.');
}

const app = getApps()[0] || initializeApp(firebaseConfig);

try {
  if (appCheckConfig?.recaptchaV3SiteKey) {
    initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(appCheckConfig.recaptchaV3SiteKey),
      isTokenAutoRefreshEnabled: true
    });
  }
} catch (error) {
  console.warn('[TAD Cost Estimator] App Check initialization warning', error);
}

const auth = getAuth(app);
const db = getFirestore(app);

let currentUser = null;
let canEdit = false;
let subscribed = false;
let materialsEmpty = true;

function normalizedEmail(value = '') {
  return String(value).trim().toLowerCase();
}

function currentUserCanEdit(user) {
  return !!(
    user?.email &&
    user.emailVerified &&
    CURRENT_PRICING_EDITORS.has(normalizedEmail(user.email))
  );
}

function updateAccessStatus(message = '') {
  ui.setAccess({
    canEdit,
    email: currentUser?.email || '',
    materialsEmpty,
    message
  });
}

function subscribeSharedPricing() {
  if (subscribed) return;
  subscribed = true;

  onSnapshot(
    collection(db, 'materials'),
    snap => {
      materialsEmpty = snap.empty;

      const materials = snap.empty
        ? ui.defaultPricing()
        : snap.docs
            .map(d => ({ id: d.id, ...d.data() }))
            .sort((a, b) => String(a.name).localeCompare(String(b.name)));

      ui.applyPricing(materials, materialsEmpty);

      updateAccessStatus(
        materialsEmpty
          ? 'No shared pricing has been published yet. Starter values are being shown.'
          : 'Live shared pricing loaded from Firestore.'
      );
    },
    error => {
      console.error('[TAD Cost Estimator] Shared material subscription failed', error);
      ui.applyPricing(ui.defaultPricing(), true);
      ui.setAccess({
        canEdit: false,
        email: currentUser?.email || '',
        materialsEmpty: true,
        message: 'Shared pricing could not be loaded. Starter values are being shown temporarily.'
      });
    }
  );

  onSnapshot(
    doc(db, 'pricingConfig', 'sheetMetalTiers'),
    snap => {
      ui.applyTiers(
        snap.exists() && Array.isArray(snap.data()?.tiers)
          ? snap.data().tiers
          : ui.defaultTiers()
      );
    },
    error => {
      console.error('[TAD Cost Estimator] Shared tier subscription failed', error);
      ui.applyTiers(ui.defaultTiers());
    }
  );
}

async function saveMaterial(material) {
  if (!canEdit || !currentUser?.email) {
    throw new Error('NOT_AUTHORIZED');
  }

  const id = String(material.id || '').trim();
  if (!id) throw new Error('MATERIAL_ID_REQUIRED');

  await setDoc(doc(db, 'materials', id), {
    name: String(material.name || '').trim(),
    method: material.method,
    rate: Number(material.rate || 0),
    finishGroup: material.finishGroup,
    active: !!material.active,
    demo: !!material.demo,
    updatedAt: serverTimestamp(),
    updatedBy: currentUser.email
  });
}

async function removeMaterial(id) {
  if (!canEdit) throw new Error('NOT_AUTHORIZED');
  await deleteDoc(doc(db, 'materials', id));
}

async function saveTiers(tiers) {
  if (!canEdit || !currentUser?.email) {
    throw new Error('NOT_AUTHORIZED');
  }

  await setDoc(doc(db, 'pricingConfig', 'sheetMetalTiers'), {
    tiers: tiers.map(t => ({
      max: Number(t.max || 0),
      total: Number(t.total || 0)
    })),
    updatedAt: serverTimestamp(),
    updatedBy: currentUser.email
  });
}

async function publishDefaults() {
  if (!canEdit || !currentUser?.email) {
    throw new Error('NOT_AUTHORIZED');
  }

  const defaults = ui.defaultPricing();
  const defaultTiers = ui.defaultTiers();

  const existing = await getDocs(collection(db, 'materials'));
  const batch = writeBatch(db);

  existing.docs.forEach(d => batch.delete(d.ref));

  defaults.forEach(material => {
    batch.set(doc(db, 'materials', material.id), {
      name: material.name,
      method: material.method,
      rate: Number(material.rate || 0),
      finishGroup: material.finishGroup,
      active: !!material.active,
      demo: !!material.demo,
      updatedAt: serverTimestamp(),
      updatedBy: currentUser.email
    });
  });

  batch.set(doc(db, 'pricingConfig', 'sheetMetalTiers'), {
    tiers: defaultTiers,
    updatedAt: serverTimestamp(),
    updatedBy: currentUser.email
  });

  await batch.commit();
}

window.TADSharedPricingApi = {
  saveMaterial,
  removeMaterial,
  saveTiers,
  publishDefaults
};

onAuthStateChanged(auth, async user => {
  if (!user) {
    try {
      await signInAnonymously(auth);
    } catch (error) {
      console.error('[TAD Cost Estimator] Anonymous sign-in failed', error);
      ui.setAccess({
        canEdit: false,
        email: '',
        materialsEmpty: true,
        message: 'Firebase reporting access could not be initialized.'
      });
    }
    return;
  }

  currentUser = user;
  canEdit = currentUserCanEdit(user);

  updateAccessStatus(
    canEdit
      ? `Shared-pricing editing enabled for ${user.email}.`
      : 'Shared pricing is read-only for students and anonymous users.'
  );

  subscribeSharedPricing();
});
