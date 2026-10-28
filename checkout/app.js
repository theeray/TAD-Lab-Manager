import { firebaseConfig, appCheckConfig } from '../firebase-config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, sendEmailVerification, sendPasswordResetEmail, signOut, reload, getIdToken, connectAuthEmulator } from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js';
import { getFunctions, httpsCallable, connectFunctionsEmulator } from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-functions.js';
import { initializeAppCheck, ReCaptchaV3Provider } from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-app-check.js';

const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const currentUrl = new URL(location.href);
const localEmulator = ['localhost', '127.0.0.1'].includes(location.hostname) && currentUrl.searchParams.get('emulator') === '1';
const app = initializeApp(localEmulator ? { ...firebaseConfig, projectId: 'demo-tad-checkout', apiKey: 'demo-api-key' } : firebaseConfig);
const auth = getAuth(app);
const functions = getFunctions(app, 'us-central1');
if (localEmulator) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFunctionsEmulator(functions, '127.0.0.1', 5001);
} else if (appCheckConfig.recaptchaV3SiteKey) {
  initializeAppCheck(app, { provider: new ReCaptchaV3Provider(appCheckConfig.recaptchaV3SiteKey), isTokenAutoRefreshEnabled: true });
}
const call = async (name, data = {}) => (await httpsCallable(functions, name)(data)).data;
let assetId = currentUrl.searchParams.get('asset') || '';
if (!/^[A-Za-z0-9_-]{1,64}$/.test(assetId)) assetId = '';
let signingUp = false;
let session = null;
let managerData = null;
let returningLoanId = '';
let requestId = crypto.randomUUID();
let lastVerificationSent = 0;
let authGeneration = 0;
let pageBusy = false;

function notice(message, error = false) {
  $('#notice').textContent = message;
  $('#notice').classList.toggle('error', error);
}
function displayDate(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}
function showFailure(error) {
  const messages = {
    'auth/email-already-in-use': 'An account already uses that address. Choose Sign in, or reset your password.',
    'auth/invalid-credential': 'The email or password wasn’t recognized.',
    'auth/weak-password': 'Choose a stronger password with at least six characters.',
    'auth/too-many-requests': 'Too many attempts. Please wait a little before trying again.',
    'auth/unauthorized-continue-uri': 'The verification return address needs to be enabled for this pilot. Contact a lab manager.',
    'auth/invalid-continue-uri': 'The verification return address needs to be enabled for this pilot. Contact a lab manager.',
    'functions/not-found': 'The checkout pilot service is not available yet. Your account is still saved.',
    'functions/unavailable': 'The checkout service could not be reached. Check your connection and try again.',
    'functions/internal': 'The request could not be completed. Check your connection or ask a lab manager.',
    'auth/network-request-failed': 'Check your connection and try again.',
  };
  const serviceMessage = error.code?.startsWith('functions/') ? error.message : null;
  notice(messages[error.code] || serviceMessage || 'This action could not be completed. Please try again.', true);
}
async function run(button, fn) {
  if (pageBusy) return;
  pageBusy = true;
  const enabledButtons = [...document.querySelectorAll('button:not(:disabled)')];
  enabledButtons.forEach(item => { item.disabled = true; });
  document.querySelector('main').setAttribute('aria-busy', 'true');
  try { await fn(); } catch (error) { showFailure(error); }
  finally {
    pageBusy = false;
    enabledButtons.forEach(item => { item.disabled = false; });
    document.querySelector('main').removeAttribute('aria-busy');
    updateReadiness();
  }
}
function actionSettings() {
  // Derive the path locally; never accept an arbitrary redirect from a QR URL.
  const url = new URL('/equipment-checkout.html', location.origin);
  if (assetId) url.searchParams.set('asset', assetId);
  if (localEmulator) url.searchParams.set('emulator', '1');
  return { url: url.href, handleCodeInApp: false };
}
async function sendVerification() {
  if (Date.now() - lastVerificationSent < 60000) {
    notice('A verification email was just sent. Please wait a minute before requesting another.'); return;
  }
  await sendEmailVerification(auth.currentUser, actionSettings());
  lastVerificationSent = Date.now();
  notice(`Verification email sent to ${auth.currentUser.email}. Open it, then return to this checkout.`);
}
function renderAsset(asset = null) {
  $('#assetInput').value = assetId;
  $('#assetLabel').textContent = asset?.label || (assetId ? 'Selected iPad' : 'Scan an iPad case');
  $('#assetNumber').textContent = asset ? `Asset ${asset.assetNumber}` : assetId || 'Its asset number will appear here.';
  $('#assetModel').textContent = asset?.model || '';
  $('#assetStatus').textContent = asset ? (asset.available ? 'Available' : 'Checked out') : assetId ? 'Verify account to continue' : 'Awaiting scan';
}
function updateReadiness() {
  const user = auth.currentUser;
  const ready = !!user?.emailVerified && session?.user?.verified && session?.enabled && session?.asset?.active && session?.asset?.available && session?.asset?.assetNumberValid === true && !pageBusy;
  $('#submitCheckout').disabled = !ready;
  $('#checkoutReadiness').textContent = !assetId ? 'Scan the QR code on an iPad case to select it.'
    : !session?.asset ? 'This iPad has not been registered for the pilot yet.'
    : !session.asset.assetNumberValid ? 'A lab manager needs to verify the 7-digit university asset number before checkout.'
    : !session.enabled ? 'The pilot is not accepting checkouts yet.'
    : !session.asset.available ? 'This iPad is already checked out.' : 'The asset number and your verified email are recorded automatically.';
}
function renderOwnLoans(loans) {
  $('#ownLoansPanel').hidden = !loans?.length;
  $('#ownLoans').innerHTML = [...(loans || [])].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).map(l =>
    `<div class="loan-row"><strong>${esc(l.assetLabel)}</strong> · ${esc(l.assetNumber)}<br>${l.status === 'returned' ? 'Returned' : 'Checked out'} · Due ${esc(l.dueDate)}<br><span class="muted">Recorded ${esc(displayDate(l.createdAt))}</span></div>`).join('');
}
async function refreshSession({ quiet = false } = {}) {
  const user = auth.currentUser;
  const generation = authGeneration;
  if (!user || user.isAnonymous) return;
  const data = await call('checkoutSession', { assetId });
  if (generation !== authGeneration || auth.currentUser?.uid !== user.uid) return;
  session = data;
  renderAsset(data.asset);
  $('#managerNav').hidden = !data.user.manager || !user.emailVerified;
  $('#borrowerEmail').textContent = user.email;
  if (!$('#borrowerName').value) $('#borrowerName').value = data.profile?.name || user.displayName || '';
  renderOwnLoans(data.loans);
  updateReadiness();
  if (!quiet) notice(!assetId ? 'Scan an iPad sticker to begin, or open Manager history to set up the pilot.'
    : data.asset ? 'Your email is verified. Review this iPad and complete the checkout details.'
    : 'This iPad is not registered for the pilot yet. Ask a lab manager.');
  if (location.hash === '#manager' && data.user.manager && user.emailVerified) await showManager();
}
function clearPrivateViews() {
  session = null; managerData = null;
  $('#managerPanel').hidden = true; $('#studentView').hidden = false; $('#managerNav').hidden = true;
  $('#historyRows').replaceChildren(); $('#ownLoans').replaceChildren(); $('#ownLoansPanel').hidden = true;
  $('#confirmation').hidden = true; $('#checkoutForm').reset(); $('#borrowerName').value = '';
  $('#returnDialog').close();
}
onAuthStateChanged(auth, async user => {
  authGeneration += 1;
  clearPrivateViews();
  const signedIn = !!user && !user.isAnonymous;
  $('#accountPanel').hidden = signedIn;
  $('#verifyPanel').hidden = !signedIn || user.emailVerified;
  $('#checkoutPanel').hidden = !signedIn || !user.emailVerified;
  $('#signOut').hidden = !signedIn;
  renderAsset();
  if (!signedIn) { notice(assetId ? 'Your iPad is selected. Sign in or create an account to continue.' : 'Scan the QR code on an iPad case, or sign in to set up the pilot.'); return; }
  $('#verificationEmail').textContent = user.email;
  if (!user.emailVerified) { notice('Verify your email before checking out equipment. Your selected iPad is saved in this link.'); return; }
  try { await refreshSession(); } catch (error) { showFailure(error); }
});
function chooseMode(signup) {
  signingUp = signup;
  $('#chooseSignIn').setAttribute('aria-pressed', String(!signup));
  $('#chooseSignUp').setAttribute('aria-pressed', String(signup));
  $('#accountAction').textContent = signup ? 'Create account & verify email' : 'Sign in';
  $('#password').autocomplete = signup ? 'new-password' : 'current-password';
  $('#resetPassword').hidden = signup;
}
$('#chooseSignIn').onclick = () => chooseMode(false);
$('#chooseSignUp').onclick = () => chooseMode(true);
$('#accountForm').onsubmit = event => {
  event.preventDefault();
  run($('#accountAction'), async () => {
    const email = $('#email').value.trim(); const password = $('#password').value;
    if (signingUp) { await createUserWithEmailAndPassword(auth, email, password); await sendVerification(); }
    else await signInWithEmailAndPassword(auth, email, password);
    $('#password').value = '';
  });
};
$('#resetPassword').onclick = () => run($('#resetPassword'), async () => {
  if (!$('#email').reportValidity()) return;
  await sendPasswordResetEmail(auth, $('#email').value.trim(), actionSettings());
  notice('If an account uses that address, a password reset email has been requested.');
});
$('#signOut').onclick = () => run($('#signOut'), async () => { await signOut(auth); notice('Signed out. Your selected iPad is still in this link.'); });
$('#resend').onclick = () => run($('#resend'), sendVerification);
async function recheckVerification() {
  const user = auth.currentUser;
  if (!user || user.isAnonymous) return;
  await reload(user);
  await getIdToken(user, true);
  if (!user.emailVerified) { notice('That email is not verified yet. Open the verification link in your inbox, then try again.'); return; }
  $('#verifyPanel').hidden = true;
  $('#checkoutPanel').hidden = false;
  await refreshSession();
}
$('#verified').onclick = () => run($('#verified'), recheckVerification);
window.addEventListener('focus', () => { if (auth.currentUser && !auth.currentUser.emailVerified && !pageBusy) run(null, recheckVerification); });
$('#assetLookup').onsubmit = event => {
  event.preventDefault();
  const url = new URL(location.href); url.searchParams.set('asset', $('#assetInput').value.trim());
  location.href = url.href;
};
$('#condition').onchange = () => { $('#conditionNotes').required = $('#condition').value === 'Existing damage'; };
$('#checkoutForm').onsubmit = event => {
  event.preventDefault();
  run($('#submitCheckout'), async () => {
    await reload(auth.currentUser); await getIdToken(auth.currentUser, true);
    if (!auth.currentUser.emailVerified) { await recheckVerification(); return; }
    const result = await call('checkoutSubmit', {
      assetId, requestId, name: $('#borrowerName').value.trim(), course: $('#course').value.trim(), purpose: $('#purpose').value.trim(),
      dueDate: $('#dueDate').value, condition: $('#condition').value, notes: $('#conditionNotes').value.trim(),
      accessories: [...document.querySelectorAll('[name=accessory]:checked')].map(e => e.value), agreement: $('#agreement').checked ? 'ipad-pilot-v1' : '',
    });
    $('#confirmationText').textContent = `${session.asset.label} · Asset ${session.asset.assetNumber} · Return by ${$('#dueDate').value}. Record ${result.loanId.slice(0, 12)}.`;
    $('#confirmation').hidden = false; $('#checkoutPanel').hidden = true;
    notice('Checkout saved. Email and spreadsheet deliveries are tracked separately by lab managers.');
    await refreshSession({ quiet: true });
    requestId = crypto.randomUUID();
    $('#confirmation').scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
};
async function showManager() {
  const generation = authGeneration;
  const data = await call('checkoutDashboard');
  if (generation !== authGeneration || !auth.currentUser?.emailVerified) return;
  managerData = data;
  $('#studentView').hidden = true; $('#managerPanel').hidden = false;
  location.hash = 'manager';
  const { config, assets, events, outbox, recipients, sheetServiceAccount } = managerData;
  const asset = assets.find(a => a.id === config.pilotAssetId);
  $('#registerForm').hidden = !!asset; $('#registeredAsset').hidden = !asset;
  if (asset) {
    const url = new URL('/equipment-checkout.html', localEmulator ? location.origin : 'https://tad-lab-manager.web.app'); url.searchParams.set('asset', asset.id);
    if (localEmulator) url.searchParams.set('emulator', '1');
    $('#registeredAsset').innerHTML = `<p><strong>${esc(asset.label)}</strong><br>Asset ${esc(asset.assetNumber)}<br>${esc(asset.model)}</p><p class="small">University asset numbers must contain exactly 7 digits.</p><p class="small">QR sticker destination:</p><p><a href="${esc(url.href)}">${esc(url.href)}</a></p><p class="small muted">Use this permanent link when printing the case sticker.</p>`;
  }
  $('#sheetUrl').value = config.spreadsheetId || '';
  $('#sheetUrl').readOnly = !!config.spreadsheetId;
  $('#sheetAccount').textContent = sheetServiceAccount;
  $('#notificationMode').value = config.notificationMode || 'off';
  $('#pilotEnabled').checked = config.enabled === true;
  $('#recipientList').textContent = recipients.join(' · ');
  const returned = new Set(events.filter(e => e.eventType === 'return').map(e => e.loanId));
  $('#historyEmpty').hidden = events.length > 0;
  $('#historyRows').innerHTML = events.map(e => {
    const job = outbox.find(o => o.eventId === e.id);
    return `<tr><td>${esc(displayDate(e.createdAt))}</td><td>${esc(e.eventType)}</td><td>${esc(e.assetNumber)}<small>${esc(e.assetLabel)}</small></td><td>${esc(e.borrowerName)}<small>${esc(e.borrowerEmail)}</small></td><td>${esc(e.dueDate)}</td><td>${esc(job?.status || 'See delivery log')}<small>${esc(job?.lastError || '')}</small></td><td>${e.eventType === 'checkout' && !returned.has(e.loanId) ? `<button class="btn secondary" type="button" data-return="${esc(e.loanId)}">Confirm return</button>` : '—'}</td></tr>`;
  }).join('');
  notice(`Pilot ${config.enabled ? 'enabled' : 'paused'} · Email: ${config.notificationMode || 'off'} · Spreadsheet: ${config.spreadsheetId ? 'configured — check delivery status below' : 'not configured'}.`);
}
$('#managerNav').onclick = () => run($('#managerNav'), showManager);
$('#refreshHistory').onclick = () => run($('#refreshHistory'), showManager);
$('#backToCheckout').onclick = () => { $('#managerPanel').hidden = true; $('#studentView').hidden = false; location.hash = ''; };
function updateAssetNumberValidation() {
  const number = $('#registerNumber');
  const value = number.value.trim();
  const message = /^[0-9]{7}$/.test(value) && value.length === 7 ? ''
    : 'Enter exactly 7 digits from the university asset label. Do not include the ownership text.';
  number.setCustomValidity(message);
  number.setAttribute('aria-invalid', String(!!number.value && !!message));
  $('#registerNumberHint').textContent = `${value.length} of 7 characters entered. Digits only; keep leading zeros. “PROPERTY OF THE STATE OF MINNESOTA” is not part of the number.`;
}
$('#registerNumber').addEventListener('input', updateAssetNumberValidation);
updateAssetNumberValidation();
$('#registerForm').onsubmit = event => { event.preventDefault(); updateAssetNumberValidation(); if (!$('#registerForm').reportValidity()) return; run(event.submitter, async () => {
  await call('checkoutRegisterAsset', { assetId: $('#registerId').value.trim(), assetNumber: $('#registerNumber').value.trim(), label: $('#registerLabel').value.trim(), model: $('#registerModel').value.trim() });
  await showManager();
}); };
$('#settingsForm').onsubmit = event => { event.preventDefault(); run(event.submitter, async () => {
  const entered = $('#sheetUrl').value.trim();
  const spreadsheetId = entered.match(/^https:\/\/docs\.google\.com\/spreadsheets\/d\/([A-Za-z0-9_-]+)/)?.[1] || entered;
  await call('checkoutConfigure', { enabled: $('#pilotEnabled').checked, notificationMode: $('#notificationMode').value, spreadsheetId });
  await showManager();
}); };
$('#retryDelivery').onclick = () => run($('#retryDelivery'), async () => { await call('checkoutRetryDelivery'); await showManager(); });
$('#historyRows').onclick = event => {
  const button = event.target.closest('[data-return]'); if (!button) return;
  returningLoanId = button.dataset.return;
  const loan = managerData.events.find(e => e.loanId === returningLoanId && e.eventType === 'checkout');
  $('#returnSummary').textContent = `${loan.assetLabel} · ${loan.assetNumber} · ${loan.borrowerName}. Confirm that lab staff have received the equipment.`;
  $('#returnNotes').value = ''; $('#returnDialog').showModal();
};
$('#cancelReturn').onclick = () => $('#returnDialog').close();
$('#returnForm').onsubmit = event => { event.preventDefault(); run(event.submitter, async () => {
  await call('checkoutRecordReturn', { loanId: returningLoanId, notes: $('#returnNotes').value.trim() });
  $('#returnDialog').close(); await showManager();
}); };
function csvCell(value) {
  let text = String(value ?? ''); if (/^(?:\s*[=+\-@]|[\t\r])/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
$('#exportHistory').onclick = () => {
  if (!managerData) return;
  const fields = ['sequence', 'eventType', 'createdAt', 'assetId', 'assetNumber', 'assetLabel', 'borrowerName', 'borrowerEmail', 'course', 'purpose', 'dueDate', 'condition', 'accessories', 'notes', 'recordedBy', 'loanId', 'returnNotes', 'agreement'];
  const lines = [fields, ...managerData.events.map(e => fields.map(f => Array.isArray(e[f]) ? e[f].join('; ') : e[f]))];
  const url = URL.createObjectURL(new Blob(['\uFEFF' + lines.map(r => r.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = 'TAD-checkout-history.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
};
window.addEventListener('unhandledrejection', event => { showFailure(event.reason || {}); });
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const maxDate = new Date(`${today}T12:00:00Z`); maxDate.setUTCDate(maxDate.getUTCDate() + 30);
const nextDate = new Date(`${today}T12:00:00Z`); nextDate.setUTCDate(nextDate.getUTCDate() + 1);
$('#dueDate').min = today;
$('#dueDate').max = maxDate.toISOString().slice(0, 10);
$('#dueDate').defaultValue = nextDate.toISOString().slice(0, 10);
renderAsset();
