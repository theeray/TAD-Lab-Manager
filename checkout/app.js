import { eventViews, filterHistory } from './history-view.mjs';
import { loanStatus } from './loan-status.mjs';
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
let renewingLoanId = '';
let serverTimeOffset = 0;
const viewNow = () => Date.now() + serverTimeOffset;
function syncClock(data) { if (data.serverNow) serverTimeOffset = Date.parse(data.serverNow) - Date.now(); }
function statusMarkup(loan) {
  const status = loanStatus(loan, viewNow());
  return `<span class="loan-status ${status.state}" data-loan-status="${status.state}"><span class="status-icon" aria-hidden="true">${status.icon}</span>${esc(status.label)}</span>`;
}

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
    if (session) renderOwnLoans(session.loans);
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
  const active = session?.loans?.find(loan => loan.status === 'checked-out');
  const renewing = active?.id === renewingLoanId && active?.assetId === assetId && loanStatus(active, viewNow()).needsCheckout;
  const ready = !!user?.emailVerified && session?.user?.verified && session?.enabled && session?.asset?.active &&
    (session.asset.available && !active || renewing) && session?.asset?.assetNumberValid === true && !pageBusy;
  $('#submitCheckout').disabled = !ready;
  $('#submitCheckout').textContent = renewingLoanId ? 'Record new eight-week checkout' : 'Record checkout';
  $('#checkoutReadiness').textContent = !assetId ? 'Scan the QR code on an iPad case to select it.'
    : !session?.asset ? 'This iPad has not been registered for the pilot yet.'
    : !session.asset.assetNumberValid ? 'A lab manager needs to verify the 7-digit university asset number before checkout.'
    : !session.enabled ? 'The pilot is not accepting checkouts yet.'
    : renewing ? 'Complete this form again for the new module. Your previous checkout stays in the permanent history.'
    : !session.asset.available ? 'This iPad is checked out. At eight weeks, use “Re-checkout this iPad” in your history, or return it to lab staff.'
    : active ? 'Return your current iPad before borrowing another.'
    : 'The asset number, verified email, and eight-week deadline are recorded automatically.';
}
function renderOwnLoans(loans) {
  $('#ownLoansPanel').hidden = !loans?.length;
  $('#ownLoans').innerHTML = [...(loans || [])].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).map(l => {
    const status = loanStatus(l, viewNow());
    return `<div class="loan-row"><strong>${esc(l.assetLabel)}</strong> · ${esc(l.assetNumber)}<br>${statusMarkup(l)}<br>Return or re-checkout by ${esc(displayDate(l.renewalDueAt))}<br><span class="muted">Recorded ${esc(displayDate(l.createdAt))}</span>${status.needsCheckout ? `<p><button class="btn primary" type="button" data-renew="${esc(l.id)}" ${pageBusy || !session?.enabled ? 'disabled' : ''}>Re-checkout this iPad</button></p>` : ''}</div>`;
  }).join('');
}
async function refreshSession({ quiet = false } = {}) {
  const user = auth.currentUser;
  const generation = authGeneration;
  if (!user || user.isAnonymous) return;
  const data = await call('checkoutSession', { assetId });
  if (generation !== authGeneration || auth.currentUser?.uid !== user.uid) return;
  session = data;
  syncClock(data);
  $('#dueDate').value = displayDate(data.checkoutDueAt);
  if (renewingLoanId && !data.loans.some(loan => loan.id === renewingLoanId && loan.status === 'checked-out')) renewingLoanId = '';
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
  session = null; managerData = null; renewingLoanId = ''; serverTimeOffset = 0;
  $('#managerPanel').hidden = true; $('#studentView').hidden = false; $('#managerNav').hidden = true;
  $('#activeLoans').replaceChildren(); $('#historyRows').replaceChildren(); $('#historyFilters').reset(); $('#historyResults').textContent = ''; $('#loadOlderHistory').hidden = true; $('#ownLoans').replaceChildren(); $('#ownLoansPanel').hidden = true;
  $('#confirmation').hidden = true; $('#checkoutForm').reset(); $('#borrowerName').value = '';
  $('#returnDialog').close(); $('#returnSummary').textContent = ''; $('#returnNotes').value = ''; returningLoanId = '';
  $('#recipientList').textContent = ''; $('#registeredAsset').replaceChildren();
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
    const wasRenewal = !!renewingLoanId;
    const result = await call('checkoutSubmit', {
      assetId, requestId, name: $('#borrowerName').value.trim(), course: $('#course').value.trim(), purpose: $('#purpose').value.trim(),
      renewLoanId: renewingLoanId || null, condition: $('#condition').value, notes: $('#conditionNotes').value.trim(),
      accessories: [...document.querySelectorAll('[name=accessory]:checked')].map(e => e.value), agreement: $('#agreement').checked ? 'ipad-eight-week-v2' : '',
    });
    $('#confirmationText').textContent = `${session.asset.label} · Asset ${session.asset.assetNumber} · Return or re-checkout by ${displayDate(result.renewalDueAt)}. Record ${result.loanId.slice(0, 12)}.`;
    $('#confirmation').hidden = false; $('#checkoutPanel').hidden = true;
    notice(`${wasRenewal ? 'New eight-week checkout' : 'Checkout'} saved. Email notifications are tracked separately by lab managers.`);
    await refreshSession({ quiet: true });
    requestId = crypto.randomUUID();
    $('#confirmation').scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
};
async function showManager() {
  const generation = authGeneration;
  const data = await call('checkoutDashboard');
  if (generation !== authGeneration || !auth.currentUser?.emailVerified) return;
  managerData = data; syncClock(data);
  $('#studentView').hidden = true; $('#managerPanel').hidden = false;
  location.hash = 'manager';
  const { config, assets } = managerData;
  const asset = assets.find(a => a.id === config.pilotAssetId);
  $('#registerForm').hidden = !!asset; $('#registeredAsset').hidden = !asset;
  if (asset) {
    const url = new URL('/equipment-checkout.html', localEmulator ? location.origin : 'https://tad-lab-manager.web.app'); url.searchParams.set('asset', asset.id);
    if (localEmulator) url.searchParams.set('emulator', '1');
    $('#registeredAsset').innerHTML = `<p><strong>${esc(asset.label)}</strong><br>Asset ${esc(asset.assetNumber)}<br>${esc(asset.model)}</p><p class="small">University asset numbers must contain exactly 7 digits.</p><p class="small">QR sticker destination:</p><p><a href="${esc(url.href)}">${esc(url.href)}</a></p><p class="small muted">Use this permanent link when printing the case sticker.</p>${asset.id === 'IPAD-07' && asset.assetNumber === '1982096' ? '<figure class="pilot-qr"><img src="checkout/qr/IPAD-07.svg" alt="QR code for Student iPad number 07, asset 1982096" width="220" height="220"><figcaption><a href="checkout/qr/IPAD-07.svg" download="TAD-iPad-07-QR.svg">Download QR sticker image</a></figcaption></figure>' : ''}`;
  }
  $('#notificationMode').value = config.notificationMode || 'beta';
  $('#pilotEnabled').checked = config.enabled === true;
  updateRecipientSummary();
  renderManagerLoans();
  notice(`Pilot ${config.enabled ? 'enabled' : 'paused'} · Email: ${config.notificationMode || 'off'} · Records saved in TAD Lab Manager.`);
}
function updateRecipientSummary() {
  if (!managerData) return;
  const mode = $('#notificationMode').value;
  const recipients = mode === 'stakeholders' ? managerData.recipients : managerData.betaRecipients;
  $('#recipientList').textContent = mode === 'off' ? 'Email is off. Checkout records are still saved in this app.'
    : `${mode === 'beta' ? 'Beta: Eric Carlson and Nick Lowery' : 'Full rollout: Eric, Chase, Andrew, and Nick'} · ${recipients.join(' · ')}`;
}
$('#notificationMode').onchange = updateRecipientSummary;
function visibleHistory() {
  if (!managerData) return [];
  return filterHistory(eventViews(managerData.events, managerData.activeLoans), {
    query: $('#historySearch').value, eventType: $('#historyEvent').value, state: $('#historyState').value,
    from: $('#historyFrom').value, to: $('#historyTo').value, order: $('#historyOrder').value,
  }, viewNow());
}
function renderManagerLoans() {
  if (!managerData) return;
  const { outbox, activeLoans } = managerData;
  $('#activeLoans').innerHTML = activeLoans.length ? activeLoans.map(loan => `<div class="loan-row"><strong>${esc(loan.assetLabel)}</strong> · Asset ${esc(loan.assetNumber)}<br>${statusMarkup(loan)}<p>${esc(loan.borrowerName)} · ${esc(loan.borrowerEmail)}<br>Return or re-checkout by ${esc(displayDate(loan.renewalDueAt))}</p></div>`).join('') : '<p class="muted">No iPads are currently checked out.</p>';
  const rows = visibleHistory();
  $('#historyEmpty').hidden = rows.length > 0;
  $('#historyEmpty').textContent = managerData.events.length ? 'No matching records in the loaded history. Adjust the filters or load older records.' : 'No checkout records yet.';
  $('#historyResults').textContent = `${rows.length} matching / ${managerData.events.length} loaded records${managerData.hasMore ? ' · Older records are available below. Search and export apply to loaded records.' : ' · All saved records are loaded.'}`;
  $('#historyTo').min = $('#historyFrom').value;
  if ($('#historyFrom').value && $('#historyTo').value && $('#historyFrom').value > $('#historyTo').value) $('#historyResults').textContent = 'Choose an end date on or after the start date.';
  $('#loadOlderHistory').hidden = !managerData.hasMore;
  $('#historyRows').innerHTML = rows.map(e => {
    const job = outbox.find(o => o.eventId === e.id);
    const emailState = { pending: 'Pending', delivered: 'Sent', failed: 'Failed — retry available', 'notifications-off': 'Off — not sent', 'awaiting-configuration': 'Needs email setup', processing: 'Sending', emulator: 'Local test' }[job?.status] || 'Not recorded';
    const eventLabel = { checkout: 'Checkout', renewal: 'Re-checkout', return: 'Return' }[e.eventType] || e.eventType;
    return `<tr><td>${esc(displayDate(e.createdAt))}</td><td>${esc(eventLabel)}</td><td>${esc(e.assetNumber)}<small>${esc(e.assetLabel)}</small></td><td>${esc(e.borrowerName)}<small>${esc(e.borrowerEmail)}</small></td><td>${esc(e.course)}<small>${esc(e.purpose)}</small></td><td>${statusMarkup(e.currentLoan)}</td><td>${esc(displayDate(e.renewalDueAt))}</td><td>${esc(emailState)}<small>${esc(job?.lastError || '')}</small></td><td>${e.canReturn ? `<button class="btn secondary" type="button" data-return="${esc(e.loanId)}">Confirm return</button>` : '—'}</td></tr>`;
  }).join('');
}
for (const id of ['historySearch', 'historyEvent', 'historyState', 'historyFrom', 'historyTo', 'historyOrder']) $(`#${id}`).addEventListener('input', renderManagerLoans);
$('#clearHistoryFilters').onclick = () => { $('#historyFilters').reset(); renderManagerLoans(); };
$('#historyFilters').onsubmit = event => event.preventDefault();
$('#loadOlderHistory').onclick = () => run($('#loadOlderHistory'), async () => {
  const generation = authGeneration;
  const page = await call('checkoutHistory', { beforeSequence: managerData.nextSequence });
  if (generation !== authGeneration || !managerData) return;
  const existing = new Set(managerData.events.map(event => event.id));
  managerData.events.push(...page.events.filter(event => !existing.has(event.id)));
  managerData.outbox.push(...page.outbox);
  managerData.hasMore = page.hasMore; managerData.nextSequence = page.nextSequence;
  renderManagerLoans();
});
$('#ownLoans').onclick = event => {
  const button = event.target.closest('[data-renew]'); if (!button) return;
  run(button, async () => {
    const loan = session?.loans.find(item => item.id === button.dataset.renew);
    if (!loan || !loanStatus(loan, viewNow()).needsCheckout) return;
    assetId = loan.assetId;
    const url = new URL(location.href); url.searchParams.set('asset', assetId); history.replaceState(null, '', url);
    await refreshSession({ quiet: true });
    renewingLoanId = loan.id; requestId = crypto.randomUUID();
    $('#checkoutForm').reset(); $('#borrowerName').value = session.profile?.name || '';
    $('#dueDate').value = displayDate(session.checkoutDueAt); $('#conditionNotes').required = false;
    $('#confirmation').hidden = true; $('#checkoutPanel').hidden = false;
    notice('Complete a fresh checkout for the next eight-week module, including condition, accessories, and acknowledgment.');
    $('#checkoutPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
};
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
  await call('checkoutConfigure', { enabled: $('#pilotEnabled').checked, notificationMode: $('#notificationMode').value });
  await showManager();
}); };
$('#retryDelivery').onclick = () => run($('#retryDelivery'), async () => { await call('checkoutRetryDelivery'); await showManager(); });
$('#historyRows').onclick = event => {
  const button = event.target.closest('[data-return]'); if (!button) return;
  returningLoanId = button.dataset.return;
  const loan = managerData.events.find(e => e.loanId === returningLoanId && e.eventType !== 'return');
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
  const fields = ['sequence', 'eventType', 'createdAt', 'assetId', 'assetNumber', 'assetLabel', 'borrowerName', 'borrowerEmail', 'course', 'purpose', 'dueDate', 'cycleStartedAt', 'renewalDueAt', 'previousLoanId', 'condition', 'accessories', 'notes', 'recordedBy', 'loanId', 'returnNotes', 'agreement'];
  const lines = [fields, ...visibleHistory().map(e => fields.map(f => Array.isArray(e[f]) ? e[f].join('; ') : e[f]))];
  const url = URL.createObjectURL(new Blob(['\uFEFF' + lines.map(r => r.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = 'TAD-checkout-filtered-history.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
};
window.addEventListener('unhandledrejection', event => { showFailure(event.reason || {}); });
setInterval(() => {
  if (pageBusy) return;
  if (session) { renderOwnLoans(session.loans); updateReadiness(); }
  if (managerData && !$('#managerPanel').hidden) renderManagerLoans();
}, 60000);
renderAsset();
