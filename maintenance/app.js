import { firebaseConfig, appCheckConfig } from '../firebase-config.js?v=20260819-2';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js';
import {
  getAuth,
  onAuthStateChanged,
  signInAnonymously,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  signOut as firebaseSignOut
} from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js';
import {
  getFirestore,
  collection,
  doc,
  addDoc,
  setDoc,
  updateDoc,
  getDocs,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
  writeBatch,
  runTransaction,
  Timestamp
} from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js';
import {
  initializeAppCheck,
  ReCaptchaV3Provider,
  getToken as getAppCheckToken
} from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-app-check.js';

const STAFF_EMAILS = new Set([
  'eric.carlson.2@bemidjistate.edu',
  'chase.cornell@bemidjistate.edu',
  'andrew.graham@bemidjistate.edu',
  'nick.lowery@bemidjistate.edu'
]);

const configured = !!firebaseConfig.projectId && !String(firebaseConfig.projectId).includes('PASTE_');
let app = null;
let appCheck = null;
let auth = null;
let fs = null;
let currentUser = null;
let staff = false;
let appCheckEnabled = false;
let appCheckDiagnostic = { status: 'not-run', message: 'Not tested yet', checkedAt: null };
let machines = [];
let starterMachines = [];
let reports = [];
let repairs = [];
let machineStatuses = [];
let tutorials = [];
let subscribed = false;
let staffSubscribed = false;

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = (s = '') => String(s).replace(/[&<>\"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const money = n => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(n || 0));
const toDate = v => v?.toDate ? v.toDate() : v instanceof Date ? v : new Date(v || Date.now());
const date = v => toDate(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const dateTime = v => toDate(v).toLocaleString('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit'
});
const totalRepair = r => Number(r.partsCost || 0) + Number(r.serviceCost || 0);

const PUBLIC_MACHINE_STATUSES = [
  'Operational',
  'Report Pending',
  'Attention',
  'Out of Service'
];

const machinePublicStatus = id =>
  machineStatuses.find(s => s.id === id)?.status || 'Operational';

const machineStatusDescription = status => ({
  'Operational': 'No current maintenance concerns reported.',
  'Report Pending': 'Open maintenance report awaiting staff review.',
  'Attention': 'Maintenance issue confirmed; check before use.',
  'Out of Service': 'Do not use until cleared by staff.'
}[status] || 'Status unavailable.');
const machine = id => machines.find(m => m.id === id) || starterMachines.find(m => m.id === id) || { id, name: 'Unknown Machine', room: '', tutorialEquipment: '' };
const badge = v => `<span class="badge ${String(v).toLowerCase().replaceAll(' ', '')}">${esc(v)}</span>`;
const slug = s => String(s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2300);
}

function normalizedEmail(value = '') {
  return String(value).trim().toLowerCase();
}

function isApprovedStaffEmail(email) {
  return STAFF_EMAILS.has(normalizedEmail(email));
}

function isApprovedStaffUser(user) {
  if (!user?.email) return false;
  const passwordProvider = user.providerData?.some(p => p.providerId === 'password');
  return passwordProvider && user.emailVerified && isApprovedStaffEmail(user.email);
}

const titles = {
  dashboard: ['Dashboard', 'Lab equipment status, resources, issues, repairs, and costs.'],
  report: ['Report a Problem', 'Submit a machine issue from a Linktree maintenance button or the app.'],
  tutorials: ['Tutorials', 'Direct TAD tutorials for machines, software, and lab workflows.'],
  reports: ['Reports', 'Review and manage issue history.'],
  machines: ['Machines', 'Equipment inventory, maintenance links, and tutorials.'],
  costs: ['Costs & Repairs', 'Track repair history and lifetime equipment costs.'],
  export: ['Export / Backup', 'Download live records for Excel and archival.'],
  settings: ['Settings', 'Firebase connection, staff access, and abuse protection.']
};

function showView(v) {
  if (!titles[v]) v = 'dashboard';
  if (['reports', 'machines', 'costs', 'export'].includes(v) && !staff) {
    toast('Staff sign-in required');
    v = 'dashboard';
  }
  $$('.view').forEach(x => x.classList.remove('active'));
  $(`#view-${v}`)?.classList.add('active');
  $$('#nav button').forEach(x => x.classList.toggle('active', x.dataset.view === v));
  $('#pageTitle').textContent = titles[v][0];
  $('#pageSubtitle').textContent = titles[v][1];
  $('.sidebar').classList.remove('open');
  if (v === 'report' && new URLSearchParams(location.search).has('machine')) {
    history.replaceState(null, '', location.pathname + location.search + '#report');
  } else {
    history.replaceState(null, '', location.pathname + (location.search || '') + '#' + v);
  }
}

$$('[data-view]').forEach(b => b.onclick = () => showView(b.dataset.view));
$$('[data-go]').forEach(b => b.onclick = () => showView(b.dataset.go));
$('#quickReport').onclick = () => showView('report');
$('#mobileMenu').onclick = () => $('.sidebar').classList.toggle('open');

async function loadStaticData() {
  [tutorials, starterMachines] = await Promise.all([
    fetch('../data/tutorials.json').then(r => r.json()),
    fetch('../data/machines.json').then(r => r.json())
  ]);
  if (!machines.length) machines = starterMachines;
  renderTutorialFilters();
}

const tutorialEquipments = t => [t.equipment, t.secondaryEquipment]
  .filter(Boolean)
  .flatMap(x => String(x).split(';').map(v => v.trim()).filter(Boolean));

function renderTutorialFilters() {
  const types = [...new Set(tutorials.map(t => t.type))].sort();
  const eq = [...new Set(tutorials.flatMap(t => tutorialEquipments(t)))].sort();
  $('#tutorialType').innerHTML = '<option value="All">All types</option>' + types.map(x => `<option>${esc(x)}</option>`).join('');
  $('#tutorialEquipment').innerHTML = '<option value="All">All equipment</option>' + eq.map(x => `<option>${esc(x)}</option>`).join('');
}

function renderTutorials() {
  const q = ($('#tutorialSearch').value || '').toLowerCase();
  const type = $('#tutorialType').value || 'All';
  const eq = $('#tutorialEquipment').value || 'All';
  const list = tutorials.filter(t =>
    (type === 'All' || t.type === type) &&
    (eq === 'All' || tutorialEquipments(t).includes(eq)) &&
    (!q || [t.title, t.type, ...tutorialEquipments(t), ...(t.tags || [])].join(' ').toLowerCase().includes(q))
  ).sort((a, b) => a.title.localeCompare(b.title));

  $('#tutorialCount').textContent = `${list.length} tutorial${list.length === 1 ? '' : 's'} shown`;
  $('#tutorialGrid').innerHTML = list.map(t => `
    <article class="tutorial-card">
      <div class="tutorial-meta">${esc(tutorialEquipments(t).join(' + ') || t.type)}${t.author ? ' · ' + esc(t.author) : ''}</div>
      <h4>${esc(t.title)}</h4>
      <p>${esc((t.tags || []).join(' · ') || t.type)}</p>
      <a class="btn primary small" href="${esc(t.url)}" target="_blank" rel="noopener">Open tutorial ↗</a>
    </article>`).join('') || '<div class="empty">No tutorials match these filters.</div>';
}

['tutorialSearch', 'tutorialType', 'tutorialEquipment'].forEach(id =>
  $(`#${id}`).addEventListener(id === 'tutorialSearch' ? 'input' : 'change', renderTutorials)
);

function tutorialsForMachine(m) {
  return tutorials.filter(t => m.tutorialEquipment && tutorialEquipments(t).includes(m.tutorialEquipment))
    .sort((a, b) => a.title.localeCompare(b.title));
}

function renderMachineResourcePanel() {
  const id = $('#reportMachine').value || new URLSearchParams(location.search).get('machine');
  const m = machine(id);
  if (!m.id) {
    $('#machineResourcePanel').innerHTML = '<p>Select a machine to see its direct tutorials.</p>';
    return;
  }
  const ts = tutorialsForMachine(m);
  $('#machineResourcePanel').innerHTML = `
    <p><strong>${esc(m.name)}</strong><br>${esc(m.room || 'Location not set')}</p>
    <div class="tutorial-list">
      ${ts.slice(0, 12).map(t => `<a class="tutorial-link" target="_blank" rel="noopener" href="${esc(t.url)}">${esc(t.title)} ↗</a>`).join('') || '<span class="row-meta">No equipment-specific tutorial mapped yet.</span>'}
    </div>
    ${ts.length > 12 ? `<p class="row-meta">${ts.length - 12} more available on the Tutorials page.</p>` : ''}`;
}

function renderStaffVisibility() {
  $$('.staff-only').forEach(el => el.classList.toggle('hidden', !staff));
  $('#staffLogin').textContent = staff ? (currentUser?.email || 'Staff signed in') : 'Staff sign in';
  $('#settingsLogin').classList.toggle('hidden', staff);
  $('#signOut').classList.toggle('hidden', !staff);
  $('#authStatus').textContent = staff ? `Staff: ${currentUser.email}` : 'Student reporting access';
}

function appCheckStatusHtml() {
  const d = appCheckDiagnostic;
  const stamp = d.checkedAt ? new Date(d.checkedAt).toLocaleString() : 'Not yet checked';
  return `
    <p><strong>App Check client:</strong> ${appCheckEnabled ? 'Initialized with reCAPTCHA v3' : 'Not initialized'}</p>
    <p><strong>Token diagnostic:</strong> ${esc(d.status)} — ${esc(d.message)}</p>
    <p><strong>Last check:</strong> ${esc(stamp)}</p>
    <p><strong>Host:</strong> ${esc(location.hostname)}</p>
    <button id="runAppCheckDiagnostic" class="btn secondary small" type="button">Run App Check diagnostic</button>`;
}

function renderConnection() {
  const b = $('#setupBanner');
  if (!configured) {
    b.classList.remove('hidden');
    b.innerHTML = '<strong>Firebase setup required:</strong> add this project’s Web App configuration to <code>firebase-config.js</code>, enable Firestore + Authentication, and deploy the included rules.';
    $('#connectionStatus').textContent = 'Firebase setup required';
    $('#firebaseInfo').innerHTML = '<p>This release uses Firestore and Firebase Authentication on the <strong>Spark/no-cost plan</strong>.</p>';
    return;
  }

  if (!appCheckEnabled) {
    b.classList.remove('hidden');
    b.innerHTML = '<strong>Abuse protection not active yet:</strong> Firebase is connected, but App Check is not configured.';
  } else if (appCheckDiagnostic.status === 'error') {
    b.classList.remove('hidden');
    b.innerHTML = `<strong>App Check diagnostic failed:</strong> ${esc(appCheckDiagnostic.message)}. Leave Firestore enforcement in Monitoring until this reports success.`;
  } else {
    b.classList.add('hidden');
  }

  $('#connectionStatus').textContent = appCheckDiagnostic.status === 'success'
    ? '● Firebase + App Check verified'
    : appCheckEnabled ? '● Firebase + App Check' : '● Firebase connected';

  $('#firebaseInfo').innerHTML = `
    <p><strong>Project:</strong> ${esc(firebaseConfig.projectId)}</p>
    <p>Live machine, report, repair, and cost records are stored in Cloud Firestore.</p>
    <p><strong>Plan:</strong> Spark / no billing required for this release.</p>
    ${appCheckStatusHtml()}`;

  $('#runAppCheckDiagnostic')?.addEventListener('click', () => runAppCheckDiagnostic(true));
}

async function runAppCheckDiagnostic(forceRefresh = true) {
  if (!appCheck) {
    appCheckDiagnostic = { status: 'error', message: 'App Check is not initialized.', checkedAt: Date.now() };
    renderConnection();
    return false;
  }

  appCheckDiagnostic = { status: 'checking', message: 'Requesting an App Check token…', checkedAt: Date.now() };
  renderConnection();

  try {
    const result = await getAppCheckToken(appCheck, forceRefresh);
    if (!result?.token) throw new Error('Firebase returned no App Check token.');
    appCheckDiagnostic = {
      status: 'success',
      message: 'A valid App Check token was issued to this browser.',
      checkedAt: Date.now()
    };
    console.info('[TAD Lab Manager] App Check token diagnostic succeeded', {
      projectId: firebaseConfig.projectId,
      host: location.hostname,
      checkedAt: new Date().toISOString()
    });
    renderConnection();
    return true;
  } catch (error) {
    const code = error?.code ? `${error.code}: ` : '';
    const message = `${code}${error?.message || 'Unknown App Check error'}`;
    appCheckDiagnostic = { status: 'error', message, checkedAt: Date.now() };
    console.error('[TAD Lab Manager] App Check token diagnostic failed', {
      projectId: firebaseConfig.projectId,
      host: location.hostname,
      errorCode: error?.code || null,
      errorMessage: error?.message || String(error)
    });
    renderConnection();
    return false;
  }
}

async function initFirebase() {
  if (!configured) {
    renderConnection();
    machines = starterMachines;
    renderAll();
    return;
  }

  app = initializeApp(firebaseConfig);
  const siteKey = appCheckConfig?.recaptchaV3SiteKey || '';

  if (siteKey && !siteKey.includes('PASTE_')) {
    try {
      appCheck = initializeAppCheck(app, {
        provider: new ReCaptchaV3Provider(siteKey),
        isTokenAutoRefreshEnabled: true
      });
      appCheckEnabled = true;
      await runAppCheckDiagnostic(true);
    } catch (error) {
      appCheckDiagnostic = {
        status: 'error',
        message: `${error?.code ? error.code + ': ' : ''}${error?.message || 'App Check initialization failed'}`,
        checkedAt: Date.now()
      };
      console.error('[TAD Lab Manager] App Check initialization failed', error);
    }
  }

  renderConnection();
  auth = getAuth(app);
  fs = getFirestore(app);

  onAuthStateChanged(auth, async user => {
    currentUser = user;
    staff = isApprovedStaffUser(user);
    renderStaffVisibility();

    if (!user) {
      try {
        await signInAnonymously(auth);
      } catch (e) {
        console.error(e);
        toast('Student reporting sign-in could not start');
      }
      return;
    }

    subscribed = false;
    staffSubscribed = false;
    subscribeData();
  });
}

function subscribeData() {
  if (!fs || subscribed) return;
  subscribed = true;
  onSnapshot(collection(fs, 'machines'), snap => {
    const live = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    machines = live.length ? live : starterMachines;
    renderAll();
  }, err => {
    console.error('[TAD Lab Manager] Machine subscription failed', err);
    machines = starterMachines;
    renderAll();
  });

  onSnapshot(collection(fs, 'machineStatus'), snap => {
    machineStatuses = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderPublicMachines();
  }, err => {
    console.error('[TAD Lab Manager] Public machine-status subscription failed', err);
    machineStatuses = [];
    renderPublicMachines();
  });

  if (staff) subscribeStaffCollections();
  else {
    reports = [];
    repairs = [];
    renderAll();
  }
}

function subscribeStaffCollections() {
  if (staffSubscribed || !fs || !staff) return;
  staffSubscribed = true;
  onSnapshot(query(collection(fs, 'reports'), orderBy('createdAt', 'desc')), snap => {
    reports = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderAll();
  });
  onSnapshot(query(collection(fs, 'repairs'), orderBy('date', 'desc')), snap => {
    repairs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderAll();
  });
}

function openStaffAuthModal() {
  $('#modalBody').innerHTML = `
    <h2>Staff account</h2>
    <p>Use your approved <strong>@bemidjistate.edu</strong> address with a password created specifically for TAD Lab Manager. This is separate from your campus Microsoft password.</p>
    <div class="form-grid">
      <label class="full">Email<input id="staffEmail" type="email" autocomplete="username" placeholder="name@bemidjistate.edu"></label>
      <label class="full">Password<input id="staffPassword" type="password" autocomplete="current-password" minlength="6" placeholder="TAD Lab Manager password"></label>
      <div class="form-actions full">
        <button type="button" class="btn primary" id="staffSignInAction">Sign in</button>
        <button type="button" class="btn secondary" id="staffCreateAction">Create account</button>
        <button type="button" class="text-btn" id="staffResetAction">Reset password</button>
      </div>
      <p class="full row-meta">New accounts must use an approved staff email and verify that email before staff tools unlock.</p>
    </div>`;
  $('#modal').showModal();
  $('#staffSignInAction').onclick = staffPasswordSignIn;
  $('#staffCreateAction').onclick = createStaffAccount;
  $('#staffResetAction').onclick = resetStaffPassword;
}

function authFormValues() {
  return {
    email: normalizedEmail($('#staffEmail')?.value),
    password: $('#staffPassword')?.value || ''
  };
}

async function staffPasswordSignIn() {
  const { email, password } = authFormValues();
  if (!isApprovedStaffEmail(email)) return toast('That email is not on the approved TAD Lab Manager staff list');
  if (!password) return toast('Enter your TAD Lab Manager password');
  try {
    if (auth.currentUser) await firebaseSignOut(auth);
    const result = await signInWithEmailAndPassword(auth, email, password);
    if (!result.user.emailVerified) {
      await sendEmailVerification(result.user);
      await firebaseSignOut(auth);
      await signInAnonymously(auth);
      toast('Verify your email first. A new verification message was sent.');
      return;
    }
    if (!isApprovedStaffUser(result.user)) {
      await firebaseSignOut(auth);
      await signInAnonymously(auth);
      toast('This account is not approved for staff access');
      return;
    }
    $('#modal').close();
    subscribed = false;
    staffSubscribed = false;
    toast('Staff access enabled');
  } catch (e) {
    console.error(e);
    toast(e?.code === 'auth/invalid-credential' ? 'Email or password was not recognized' : 'Staff sign-in was not completed');
  }
}

async function createStaffAccount() {
  const { email, password } = authFormValues();
  if (!isApprovedStaffEmail(email)) return toast('That email is not on the approved TAD Lab Manager staff list');
  if (password.length < 6) return toast('Use a password with at least 6 characters');
  try {
    if (auth.currentUser) await firebaseSignOut(auth);
    const result = await createUserWithEmailAndPassword(auth, email, password);
    await sendEmailVerification(result.user);
    await firebaseSignOut(auth);
    await signInAnonymously(auth);
    $('#modal').close();
    toast('Account created. Check your email and verify it before signing in.');
  } catch (e) {
    console.error(e);
    if (e?.code === 'auth/email-already-in-use') toast('An account already exists for that email. Sign in or reset the password.');
    else toast('Staff account could not be created');
  }
}

async function resetStaffPassword() {
  const { email } = authFormValues();
  if (!isApprovedStaffEmail(email)) return toast('Enter an approved staff email first');
  try {
    await sendPasswordResetEmail(auth, email);
    toast('Password reset email sent');
  } catch (e) {
    console.error(e);
    toast('Password reset email could not be sent');
  }
}

$('#staffLogin').onclick = openStaffAuthModal;
$('#settingsLogin').onclick = openStaffAuthModal;
$('#signOut').onclick = async () => {
  await firebaseSignOut(auth);
  reports = [];
  repairs = [];
  subscribed = false;
  staffSubscribed = false;
  await signInAnonymously(auth);
  toast('Signed out');
};

function renderReportForm() {
  const sel = $('#reportMachine');
  const current = sel.value;
  const q = new URLSearchParams(location.search).get('machine');
  const list = machines.length ? machines : starterMachines;
  sel.innerHTML = list.length
    ? list.slice().sort((a, b) => a.name.localeCompare(b.name)).map(m => `<option value="${esc(m.id)}">${esc(m.name)}${m.room ? ' — ' + esc(m.room) : ''}</option>`).join('')
    : '<option value="">No machines configured</option>';
  sel.value = q && list.some(m => m.id === q)
    ? q
    : list.some(m => m.id === current) ? current : (list[0]?.id || '');
  renderMachineResourcePanel();
}

$('#reportMachine').addEventListener('change', renderMachineResourcePanel);

const MAX_REPORT_PHOTOS = 3;
const MAX_REPORT_PHOTO_DIMENSION = 1600;
const REPORT_PHOTO_QUALITY = 0.78;

let reportPhotoAttachments = [];

function clearReportPhotos() {
  reportPhotoAttachments.forEach(photo => {
    if (photo.previewUrl) URL.revokeObjectURL(photo.previewUrl);
  });
  reportPhotoAttachments = [];

  const input = $('#reportPhotos');
  if (input) input.value = '';

  const preview = $('#photoPreview');
  if (preview) preview.innerHTML = '';

  const summary = $('#photoSummary');
  if (summary) summary.textContent = 'No photos selected.';
}

function formatPhotoBytes(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function loadPhotoImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`Could not read ${file.name || 'photo'}`));
    };

    img.src = url;
  });
}

async function compressReportPhoto(file, index) {
  if (!String(file.type || '').startsWith('image/')) {
    throw new Error('Only image files can be attached.');
  }

  const img = await loadPhotoImage(file);

  const scale = Math.min(
    1,
    MAX_REPORT_PHOTO_DIMENSION / Math.max(img.naturalWidth, img.naturalHeight)
  );

  const width = Math.max(1, Math.round(img.naturalWidth * scale));
  const height = Math.max(1, Math.round(img.naturalHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Photo compression is not supported in this browser.');

  ctx.drawImage(img, 0, 0, width, height);

  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      value => value ? resolve(value) : reject(new Error('Photo compression failed.')),
      'image/jpeg',
      REPORT_PHOTO_QUALITY
    );
  });

  return {
    blob,
    filename: `maintenance-photo-${index + 1}.jpg`,
    originalName: file.name || `Photo ${index + 1}`,
    bytes: blob.size,
    previewUrl: URL.createObjectURL(blob)
  };
}

function renderReportPhotoPreview() {
  const preview = $('#photoPreview');
  const summary = $('#photoSummary');
  if (!preview || !summary) return;

  preview.innerHTML = reportPhotoAttachments.map((photo, index) => `
    <div class="photo-preview-item">
      <img src="${photo.previewUrl}" alt="Selected maintenance photo ${index + 1}">
      <div>
        <strong>Photo ${index + 1}</strong>
        <span>${formatPhotoBytes(photo.bytes)}</span>
      </div>
    </div>
  `).join('');

  if (!reportPhotoAttachments.length) {
    summary.textContent = 'No photos selected.';
    return;
  }

  const totalBytes = reportPhotoAttachments.reduce((sum, photo) => sum + photo.bytes, 0);
  summary.textContent =
    `${reportPhotoAttachments.length} photo${reportPhotoAttachments.length === 1 ? '' : 's'} prepared · ${formatPhotoBytes(totalBytes)} total`;
}

$('#reportPhotos')?.addEventListener('change', async event => {
  const selected = [...(event.target.files || [])];

  if (!selected.length) return;

  const remaining = MAX_REPORT_PHOTOS - reportPhotoAttachments.length;

  if (remaining <= 0) {
    event.target.value = '';
    toast(`Maximum ${MAX_REPORT_PHOTOS} photos already selected.`);
    return;
  }

  if (selected.length > remaining) {
    toast(
      `Only ${remaining} more photo${remaining === 1 ? '' : 's'} can be added.`
    );
  }

  const files = selected.slice(0, remaining);
  const startIndex = reportPhotoAttachments.length;

  $('#photoSummary').textContent = 'Preparing photos…';

  try {
    const prepared = await Promise.all(
      files.map((file, index) =>
        compressReportPhoto(file, startIndex + index)
      )
    );

    reportPhotoAttachments.push(...prepared);
    renderReportPhotoPreview();

    // Reset only the native picker so another camera/photo selection
    // can be added without removing already-prepared photos.
    event.target.value = '';
  } catch (error) {
    console.error('[TAD Lab Manager] Photo preparation failed', error);
    event.target.value = '';
    renderReportPhotoPreview();
    toast(error?.message || 'One or more photos could not be prepared.');
  }
});

$('#reportForm').addEventListener('reset', () => {
  setTimeout(clearReportPhotos, 0);
});

$('#reportForm').onsubmit = async e => {
  e.preventDefault();
  if (!configured || !fs) return toast('Firebase must be configured before reports can be submitted');
  if (!currentUser) return toast('Connecting to reporting service…');
  const machineId = $('#reportMachine').value;
  if (!machineId) return toast('Please choose a machine');
  const m = machine(machineId);
  const payload = {
    machineId,
    createdAt: serverTimestamp(),
    urgency: $('#urgency').value,
    usable: $('#usable').value,
    issue: $('#issue').value.trim(),
    attempted: $('#attempted').value.trim(),
    contact: $('#contact').value.trim(),
    resource: $('#resource').value.trim(),
    status: 'Open',
    machineNameSnapshot: m.name,
    roomSnapshot: m.room || '',
    submittedByUid: currentUser.uid,
    submittedByEmail: currentUser.email || ''
  };
  try {
    const reportRef = doc(collection(fs, 'reports'));
    const userCounterRef = doc(fs, 'reportRateUsers', currentUser.uid);
    const globalCounterRef = doc(fs, 'reportRateGlobal', 'reports');
    const machineStatusRef = doc(fs, 'machineStatus', machineId);

    const now = new Date();
    const day = Timestamp.fromDate(
      new Date(Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate()
      ))
    );

    await runTransaction(fs, async transaction => {
      const [userSnap, globalSnap, machineStatusSnap] = await Promise.all([
        transaction.get(userCounterRef),
        transaction.get(globalCounterRef),
        transaction.get(machineStatusRef)
      ]);

      const userData = userSnap.exists() ? userSnap.data() : null;
      const globalData = globalSnap.exists() ? globalSnap.data() : null;

      const sameUserDay =
        userData?.day?.toMillis?.() === day.toMillis();

      const sameGlobalDay =
        globalData?.day?.toMillis?.() === day.toMillis();

      const userCount = sameUserDay ? Number(userData.count || 0) + 1 : 1;
      const globalCount = sameGlobalDay ? Number(globalData.count || 0) + 1 : 1;

      if (userCount > 10) {
        throw new Error('USER_DAILY_LIMIT');
      }

      if (globalCount > 100) {
        throw new Error('GLOBAL_DAILY_LIMIT');
      }

      transaction.set(userCounterRef, {
        uid: currentUser.uid,
        day,
        count: userCount,
        updatedAt: serverTimestamp()
      });

      transaction.set(globalCounterRef, {
        day,
        count: globalCount,
        updatedAt: serverTimestamp()
      });

      transaction.set(reportRef, payload);

      const existingPublicStatus =
        machineStatusSnap.exists()
          ? machineStatusSnap.data()?.status
          : 'Operational';

      // Never downgrade a staff-confirmed Attention or Out of Service status.
      if (!['Attention', 'Out of Service'].includes(existingPublicStatus)) {
        transaction.set(machineStatusRef, {
          machineId,
          status: 'Report Pending',
          pendingReportId: reportRef.id,
          updatedAt: serverTimestamp()
        });
      }
    });

    // Immediately reflect the successful public status change in the UI.
    // Firestore has already committed this as part of the report transaction.
    const currentPublicStatus = machinePublicStatus(machineId);

    if (!['Attention', 'Out of Service'].includes(currentPublicStatus)) {
      const statusRecord = {
        id: machineId,
        machineId,
        status: 'Report Pending',
        pendingReportId: reportRef.id
      };

      const statusIndex = machineStatuses.findIndex(x => x.id === machineId);

      if (statusIndex >= 0) {
        machineStatuses[statusIndex] = {
          ...machineStatuses[statusIndex],
          ...statusRecord
        };
      } else {
        machineStatuses.push(statusRecord);
      }

      renderPublicMachines();
    }

    e.target.reset();
    clearReportPhotos();
    renderReportForm();
    toast(`Report ${reportRef.id.slice(0, 8)} submitted`);
    showView('dashboard');
  } catch (err) {
    console.error(err);

    if (err?.message === 'USER_DAILY_LIMIT') {
      toast('Daily limit reached: maximum 10 reports per browser account.');
    } else if (err?.message === 'GLOBAL_DAILY_LIMIT') {
      toast('The lab has reached its 100-report daily safety limit.');
    } else {
      toast('Report could not be submitted. The safety limit or Firestore rules may have blocked it.');
    }
  }
};

function renderStats() {
  if (!staff) return;
  const open = reports.filter(r => r.status !== 'Resolved').length;
  const down = new Set(reports.filter(r => r.status !== 'Resolved' && r.usable === 'No').map(r => r.machineId)).size;
  const year = new Date().getFullYear();
  const cost = repairs.filter(r => toDate(r.date).getFullYear() === year).reduce((a, r) => a + totalRepair(r), 0);
  const all = repairs.reduce((a, r) => a + totalRepair(r), 0);
  $('#statsGrid').innerHTML = [
    ['Open reports', open, 'Needs review or repair'],
    ['Machines down', down, 'Currently unusable'],
    [`${year} repair cost`, money(cost), 'Parts + external service'],
    ['Lifetime recorded', money(all), `${repairs.length} repair records`]
  ].map(x => `<div class="stat"><div class="value">${x[1]}</div><div class="label">${x[0]}</div><div class="sub">${x[2]}</div></div>`).join('');
}

function renderDashboard() {
  if (!staff) return;
  const rank = { Critical: 4, High: 3, Medium: 2, Low: 1 };
  const open = reports.filter(r => r.status !== 'Resolved')
    .sort((a, b) =>
      (toDate(b.createdAt) - toDate(a.createdAt)) ||
      ((rank[b.urgency] ?? 0) - (rank[a.urgency] ?? 0))
    )
    .slice(0, 6);
  $('#openIssues').innerHTML = open.length ? open.map(r => `
    <div class="issue-row"><div><div class="row-title">${esc(machine(r.machineId).name)}</div><div class="row-meta">${dateTime(r.createdAt)} · ${esc(r.issue)}</div></div>${badge(r.urgency)}</div>`).join('') : '<div class="empty">No open issues.</div>';

  const ids = [...new Set(reports.filter(r => r.status !== 'Resolved').map(r => r.machineId))];
  $('#machineAttention').innerHTML = ids.length ? ids.map(id => {
    const m = machine(id);
    const rs = reports.filter(r => r.machineId === id && r.status !== 'Resolved');
    return `<div class="attention-row"><div><div class="row-title">${esc(m.name)}</div><div class="row-meta">${esc(m.room || '')} · ${rs.length} open report${rs.length === 1 ? '' : 's'}</div></div>${badge(rs.some(r => r.usable === 'No') ? 'Down' : 'Attention')}</div>`;
  }).join('') : '<div class="empty">All machines clear.</div>';
}

function renderPublicMachines() {
  const list = machines.length ? machines : starterMachines;

  $('#publicMachines').innerHTML = list
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(m => {
      const status = machinePublicStatus(m.id);

      return `
        <article class="machine-card machine-status-${slug(status)}">
          <div class="public-machine-status status-${slug(status)}">
            <strong><span class="status-dot"></span>${esc(status)}</strong>
            <span>${esc(machineStatusDescription(status))}</span>
          </div>

          <h3>${esc(m.name)}</h3>
          <div class="machine-id">${esc(m.id)}</div>

          <div class="machine-meta">
            <div><span>Location:</span> ${esc(m.room || '—')}</div>
            <div><span>Direct tutorials:</span> ${tutorialsForMachine(m).length}</div>
          </div>

          <div class="machine-actions">
            <button class="btn primary small"
              onclick="window.reportMachine('${esc(m.id)}')">
              Report problem
            </button>

            <button class="btn secondary small"
              onclick="window.showMachineTutorials('${esc(m.tutorialEquipment || '')}')">
              Tutorials
            </button>
          </div>
        </article>`;
    }).join('') || '<div class="empty">No machines configured.</div>';
}

window.reportMachine = id => {
  const url = new URL(location.href);
  url.searchParams.set('machine', id);
  url.hash = 'report';
  location.href = url.toString();
};

window.showMachineTutorials = eq => {
  showView('tutorials');
  $('#tutorialEquipment').value = [...$('#tutorialEquipment').options].some(o => o.value === eq) ? eq : 'All';
  renderTutorials();
};

function reportTable() {
  if (!staff) return;
  const status = $('#reportStatusFilter').value;
  const q = ($('#reportSearch').value || '').toLowerCase();
  const list = reports.filter(r =>
    (status === 'All' || r.status === status) &&
    (!q || [r.id, machine(r.machineId).name, r.issue, r.contact].join(' ').toLowerCase().includes(q))
  );
  $('#reportsTable').innerHTML = list.length ? `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Machine</th><th>Urgency</th><th>Issue</th><th>Status</th><th></th></tr></thead><tbody>${list.map(r => `<tr><td>${dateTime(r.createdAt)}</td><td>${esc(machine(r.machineId).name)}</td><td>${badge(r.urgency)}</td><td>${esc(r.issue)}</td><td>${badge(r.status)}</td><td><button class="text-btn" onclick="window.manageReport('${esc(r.id)}')">Manage</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">No matching reports.</div>';
}

$('#reportStatusFilter').onchange = reportTable;
$('#reportSearch').oninput = reportTable;
window.manageReport = id => {
  const r = reports.find(x => x.id === id);
  if (!r) return;
  const publicStatus = machinePublicStatus(r.machineId);
  $('#modalBody').innerHTML = `<h2>${esc(machine(r.machineId).name)}</h2><p>${badge(r.urgency)} ${badge(r.status)}</p><p><strong>Issue</strong><br>${esc(r.issue)}</p><p><strong>Fixes tried</strong><br>${esc(r.attempted || 'None entered')}</p><p><strong>Contact</strong><br>${esc(r.contact || 'Not provided')}</p><div class="form-grid"><label>Status<select id="manageStatus"><option>Open</option><option>Diagnosing</option><option>Waiting for Part</option><option>Resolved</option></select></label><label class="full">Public machine status
<select id="manageMachineStatus">
  ${PUBLIC_MACHINE_STATUSES.map(s => `<option>${esc(s)}</option>`).join('')}
</select>
<small>This status is visible to students and anonymous viewers.</small>
</label>
<div class="form-actions"><button type="button" class="btn secondary" onclick="window.addRepairFor('${esc(r.id)}')">Add repair/cost</button><button type="button" class="btn primary" onclick="window.saveReportStatus('${esc(r.id)}')">Save status</button></div></div>`;
  $('#manageStatus').value = r.status;
  $('#manageMachineStatus').value = publicStatus;
  $('#modal').showModal();
};
window.saveReportStatus = async id => {
  const r = reports.find(x => x.id === id);
  if (!r) return;

  const reportStatus = $('#manageStatus').value;
  let publicStatus = $('#manageMachineStatus').value;

  const otherOpenReports = reports.filter(x =>
    x.machineId === r.machineId &&
    x.id !== id &&
    x.status !== 'Resolved'
  );

  // Resolving the final open report clears the machine automatically.
  if (reportStatus === 'Resolved' && otherOpenReports.length === 0) {
    publicStatus = 'Operational';
  }

  // If another unresolved report remains, never accidentally clear
  // a machine just because this individual report was resolved.
  if (
    reportStatus === 'Resolved' &&
    otherOpenReports.length > 0 &&
    publicStatus === 'Operational'
  ) {
    const currentStatus = machinePublicStatus(r.machineId);

    publicStatus =
      ['Attention', 'Out of Service'].includes(currentStatus)
        ? currentStatus
        : 'Report Pending';
  }

  const pendingReportId =
    publicStatus === 'Report Pending'
      ? (
          otherOpenReports[0]?.id ||
          (reportStatus !== 'Resolved' ? id : '')
        )
      : '';

  await Promise.all([
    updateDoc(doc(fs, 'reports', id), {
      status: reportStatus,
      updatedAt: serverTimestamp()
    }),

    setDoc(doc(fs, 'machineStatus', r.machineId), {
      machineId: r.machineId,
      status: publicStatus,
      pendingReportId,
      updatedAt: serverTimestamp()
    })
  ]);

  $('#modal').close();

  toast(
    reportStatus === 'Resolved' && otherOpenReports.length === 0
      ? 'Report resolved — machine returned to Operational'
      : 'Report and public machine status updated'
  );
};

function renderMachines() {
  if (!staff) return;
  $('#machineCards').innerHTML = machines.map(m => {
    const rs = reports.filter(r => r.machineId === m.id);
    const cost = repairs.filter(r => r.machineId === m.id).reduce((a, r) => a + totalRepair(r), 0);
    const ts = tutorialsForMachine(m);
    return `<article class="machine-card"><div class="machine-top"><div><h3>${esc(m.name)}</h3><div class="machine-id">${esc(m.id)}</div></div>${badge(m.status || 'Operational')}</div><div class="machine-meta"><div><span>Type:</span> ${esc(m.category || '—')}</div><div><span>Location:</span> ${esc(m.room || '—')}</div><div><span>Tutorial set:</span> ${esc(m.tutorialEquipment || '—')} (${ts.length})</div><div><span>Reports:</span> ${rs.length}</div><div><span>Recorded repair cost:</span> ${money(cost)}</div></div><div class="machine-actions"><button class="btn secondary small" onclick="window.copyMaintenanceLink('${esc(m.id)}')">Copy Maintenance Link</button><button class="btn secondary small" onclick="window.editMachine('${esc(m.id)}')">Edit</button></div></article>`;
  }).join('') || '<div class="empty">No machines configured. Use “Add Machine” or seed starter records from Settings.</div>';
}

window.copyMaintenanceLink = id => {
  const url = new URL(location.href);
  url.search = '';
  url.searchParams.set('machine', id);
  url.hash = 'report';
  navigator.clipboard?.writeText(url.toString());
  toast('Maintenance link copied for Linktree');
};

function machineModal(existing) {
  const m = existing || { id: '', name: '', category: '', room: '', manufacturer: '', model: '', serial: '', purchaseCost: 0, status: 'Operational', tutorialEquipment: '' };
  const eq = [...new Set(tutorials.flatMap(t => tutorialEquipments(t)))].sort();
  $('#modalBody').innerHTML = `<h2>${existing ? 'Edit' : 'Add'} machine</h2><div class="form-grid"><label>Stable ID<input id="mId" value="${esc(m.id)}" ${existing ? 'disabled' : ''}></label><label>Name<input id="mName" value="${esc(m.name)}"></label><label>Category<input id="mCategory" value="${esc(m.category || '')}"></label><label>Room<input id="mRoom" value="${esc(m.room || '')}"></label><label>Manufacturer<input id="mManufacturer" value="${esc(m.manufacturer || '')}"></label><label>Model<input id="mModel" value="${esc(m.model || '')}"></label><label>Serial<input id="mSerial" value="${esc(m.serial || '')}"></label><label>Purchase cost<input id="mCost" type="number" step="0.01" value="${Number(m.purchaseCost || 0)}"></label><label class="full">Tutorial / equipment set<select id="mTutorial"><option value="">None</option>${eq.map(x => `<option ${x === m.tutorialEquipment ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></label><div class="form-actions full"><button type="button" class="btn primary" onclick="window.saveMachine('${existing ? esc(m.id) : ''}')">Save machine</button></div></div>`;
  $('#modal').showModal();
}

$('#addMachine').onclick = () => machineModal();
window.editMachine = id => machineModal(machines.find(m => m.id === id));
window.saveMachine = async original => {
  if (!staff) return;
  const id = original || slug($('#mId').value);
  const name = $('#mName').value.trim();
  if (!id || !name) return toast('Machine ID and name are required');
  const obj = {
    name,
    category: $('#mCategory').value.trim(),
    room: $('#mRoom').value.trim(),
    manufacturer: $('#mManufacturer').value.trim(),
    model: $('#mModel').value.trim(),
    serial: $('#mSerial').value.trim(),
    purchaseCost: Number($('#mCost').value || 0),
    status: original ? (machine(original).status || 'Operational') : 'Operational',
    tutorialEquipment: $('#mTutorial').value,
    updatedAt: serverTimestamp()
  };
  await setDoc(doc(fs, 'machines', id), obj, { merge: true });
  $('#modal').close();
  toast('Machine saved');
};

function renderCosts() {
  if (!staff) return;
  const year = new Date().getFullYear();
  const thisYear = repairs.filter(r => toDate(r.date).getFullYear() === year).reduce((a, r) => a + totalRepair(r), 0);
  const all = repairs.reduce((a, r) => a + totalRepair(r), 0);
  const days = repairs.reduce((a, r) => a + Number(r.downtimeDays || 0), 0);
  $('#costStats').innerHTML = [
    ['This year', money(thisYear), 'Recorded repair spend'],
    ['All recorded', money(all), 'Parts + service'],
    ['Downtime', `${days} days`, 'Across repair records'],
    ['Repair events', repairs.length, 'Maintenance records']
  ].map(x => `<div class="stat"><div class="value">${x[1]}</div><div class="label">${x[0]}</div><div class="sub">${x[2]}</div></div>`).join('');
  $('#repairsTable').innerHTML = `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Machine</th><th>Repair / resolution</th><th>Part</th><th>Technician</th><th>Downtime</th><th>Cost</th></tr></thead><tbody>${repairs.map(r => `<tr><td>${date(r.date)}</td><td>${esc(machine(r.machineId).name)}</td><td>${esc(r.resolution)}</td><td>${esc(r.part || '—')}</td><td>${esc(r.technician || '—')}</td><td>${Number(r.downtimeDays || 0)} d</td><td><strong>${money(totalRepair(r))}</strong></td></tr>`).join('')}</tbody></table></div>`;
}

function repairModal(reportId = '') {
  const r = reports.find(x => x.id === reportId);
  $('#modalBody').innerHTML = `<h2>Add repair / cost</h2><div class="form-grid"><label class="full">Machine<select id="rMachine">${machines.map(m => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('')}</select></label><label>Related report<select id="rReport"><option value="">None</option>${reports.map(x => `<option value="${esc(x.id)}">${esc(x.id.slice(0, 8))} — ${esc(x.issue.slice(0, 45))}</option>`).join('')}</select></label><label>Technician<input id="rTech" placeholder="Name or team"></label><label class="full">Resolution / work performed<textarea id="rResolution" rows="3"></textarea></label><label>Part / item<input id="rPart"></label><label>Parts cost<input id="rParts" type="number" step="0.01" value="0"></label><label>External service cost<input id="rService" type="number" step="0.01" value="0"></label><label>Labor hours<input id="rHours" type="number" step="0.25" value="0"></label><label>Downtime days<input id="rDown" type="number" step="0.5" value="0"></label><div class="form-actions full"><button type="button" class="btn primary" onclick="window.saveRepair()">Save repair</button></div></div>`;
  if (r) {
    $('#rMachine').value = r.machineId;
    $('#rReport').value = r.id;
  }
  $('#modal').showModal();
}

$('#addRepair').onclick = () => repairModal();
window.addRepairFor = id => repairModal(id);
window.saveRepair = async () => {
  const reportId = $('#rReport').value;
  const machineId = $('#rMachine').value;
  const resolution = $('#rResolution').value.trim();
  if (!resolution) return toast('Please enter the work performed');
  await addDoc(collection(fs, 'repairs'), {
    reportId,
    machineId,
    date: serverTimestamp(),
    technician: $('#rTech').value.trim(),
    resolution,
    part: $('#rPart').value.trim(),
    partsCost: Number($('#rParts').value || 0),
    serviceCost: Number($('#rService').value || 0),
    laborHours: Number($('#rHours').value || 0),
    downtimeDays: Number($('#rDown').value || 0)
  });
  if (reportId) await updateDoc(doc(fs, 'reports', reportId), { status: 'Resolved', updatedAt: serverTimestamp() });
  $('#modal').close();
  toast('Repair record saved');
};

function csvCell(v) {
  const s = v?.toDate ? v.toDate().toISOString() : String(v ?? '');
  return `"${s.replaceAll('"', '""')}"`;
}

function download(name, text, type = 'text/csv') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function exportCsv(type) {
  let headers, rows;
  if (type === 'reports') {
    headers = ['Report ID', 'Date', 'Machine ID', 'Machine', 'Room', 'Urgency', 'Usable', 'Issue', 'Fixes Tried', 'Preferred Contact', 'Resource', 'Status'];
    rows = reports.map(r => [r.id, r.createdAt, r.machineId, machine(r.machineId).name, machine(r.machineId).room, r.urgency, r.usable, r.issue, r.attempted, r.contact, r.resource, r.status]);
  }
  if (type === 'machines') {
    headers = ['Machine ID', 'Name', 'Category', 'Room', 'Manufacturer', 'Model', 'Serial', 'Purchase Cost', 'Status', 'Tutorial Equipment'];
    rows = machines.map(m => [m.id, m.name, m.category, m.room, m.manufacturer, m.model, m.serial, m.purchaseCost, m.status, m.tutorialEquipment]);
  }
  if (type === 'repairs') {
    headers = ['Repair ID', 'Date', 'Report ID', 'Machine ID', 'Machine', 'Technician', 'Resolution', 'Part', 'Parts Cost', 'Service Cost', 'Total Cost', 'Labor Hours', 'Downtime Days'];
    rows = repairs.map(r => [r.id, r.date, r.reportId, r.machineId, machine(r.machineId).name, r.technician, r.resolution, r.part, r.partsCost, r.serviceCost, totalRepair(r), r.laborHours, r.downtimeDays]);
  }
  download(`TAD-Lab-${type}-${new Date().toISOString().slice(0, 10)}.csv`, [headers, ...rows].map(row => row.map(csvCell).join(',')).join('\n'));
}

$$('[data-export]').forEach(b => b.onclick = () => exportCsv(b.dataset.export));
$('#backupJson').onclick = () => download(`TAD-Lab-Full-Backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ machines, reports, repairs }, (k, v) => v?.toDate ? v.toDate().toISOString() : v, 2), 'application/json');

async function seedMachines() {
  if (!staff || !fs) return;
  const snap = await getDocs(collection(fs, 'machines'));
  if (!snap.empty && !confirm('Machines already exist. Add/update the starter machine records anyway?')) return;
  const batch = writeBatch(fs);
  starterMachines.forEach(m => {
    const { id, ...data } = m;
    batch.set(doc(fs, 'machines', id), { ...data, updatedAt: serverTimestamp() }, { merge: true });
  });
  await batch.commit();
  toast('Starter machine records added');
}

function renderSettingsExtras() {
  if (!staff || !configured) return;
  const info = $('#firebaseInfo');
  if (!$('#seedMachinesBtn')) info.insertAdjacentHTML('beforeend', '<button id="seedMachinesBtn" class="btn secondary">Add starter machine records</button>');
  $('#seedMachinesBtn')?.addEventListener('click', seedMachines, { once: true });
}

function renderAll() {
  renderStaffVisibility();
  renderConnection();
  renderReportForm();
  renderTutorials();
  renderPublicMachines();
  renderMachineResourcePanel();
  if (staff) {
    renderStats();
    renderDashboard();
    reportTable();
    renderMachines();
    renderCosts();
    renderSettingsExtras();
  }
}

await loadStaticData();
await initFirebase();
renderAll();
const initial = new URLSearchParams(location.search).has('machine') ? 'report' : (location.hash.replace('#', '') || 'dashboard');
showView(initial);
