import { firebaseConfig } from '../firebase-config.js?v=20260819-2';
import { getApps, initializeApp } from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js';
import {
  getFirestore,
  collection,
  doc,
  addDoc,
  getDoc,
  onSnapshot,
  setDoc,
  updateDoc,
  runTransaction,
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js';

const MANAGER_EMAILS = new Set([
  'eric.carlson.2@bemidjistate.edu',
  'chase.cornell@bemidjistate.edu',
  'andrew.graham@bemidjistate.edu',
  'nick.lowery@bemidjistate.edu'
]);

const PUBLIC_MACHINE_STATUSES = ['Operational', 'Report Pending', 'Attention', 'Out of Service'];
const OUTCOMES = [
  'Fixed',
  'Report submitted in error',
  'User training issue',
  'Temporary workaround',
  'Machine retired',
  'Follow-up required'
];
const KNOWLEDGE_TYPES = [
  'Known issue solution',
  'Manual',
  'Settings',
  'Safety',
  'Maintenance schedule',
  'Vendor',
  'Part number',
  'Procedure / rule',
  'Other'
];

const app = getApps()[0] || initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

let currentUser = null;
let manager = false;
let machines = [];
let reports = [];
let repairs = [];
let statuses = [];
let unsubscribers = [];
let staticMachines = [];

const $ = selector => document.querySelector(selector);
const esc = (value = '') => String(value).replace(/[&<>\"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const normalizedEmail = value => String(value || '').trim().toLowerCase();
const isManager = user => !!(
  user?.email &&
  user.emailVerified &&
  user.providerData?.some(p => p.providerId === 'password') &&
  MANAGER_EMAILS.has(normalizedEmail(user.email))
);
const toDate = value => value?.toDate ? value.toDate() : value instanceof Date ? value : value ? new Date(value) : null;
const dateText = value => {
  const d = toDate(value);
  return d && !Number.isNaN(d.valueOf()) ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
};
const money = value => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(value || 0));
const uid = () => crypto.randomUUID?.() || `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const machineById = id => machines.find(m => m.id === id) || staticMachines.find(m => m.id === id) || { id, name: id || 'Unknown machine', room: '', lab: '' };
const statusByMachine = id => statuses.find(s => s.id === id)?.status || 'Operational';
const openReportsForMachine = id => reports.filter(r => r.machineId === id && r.status !== 'Resolved');

function toast(message) {
  const el = $('#toast');
  if (!el) return;
  el.textContent = message;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2600);
}

function injectStyles() {
  if ($('#opsEnhancementStyles')) return;
  const style = document.createElement('style');
  style.id = 'opsEnhancementStyles';
  style.textContent = `
    .ops-status-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(290px,1fr));gap:14px;margin-top:16px}
    .ops-status-card{border:1px solid rgba(0,0,0,.12);border-radius:16px;padding:16px;background:#fff}
    .ops-status-card h4{margin:0 0 4px}.ops-status-card p{margin:0 0 12px;color:#5c6470;font-size:.92rem}
    .ops-status-card label{display:block;margin:8px 0;font-weight:700}.ops-status-card select,.ops-status-card input{width:100%;margin-top:5px}
    .ops-status-actions{display:flex;justify-content:flex-end;margin-top:10px}.ops-kb-list{display:grid;gap:12px;margin-top:16px}
    .ops-kb-item{border:1px solid rgba(0,0,0,.12);border-radius:14px;padding:14px;background:#fff}.ops-kb-item h4{margin:0 0 4px}
    .ops-kb-meta{font-size:.84rem;color:#667085;margin-bottom:8px}.ops-kb-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
    .ops-note{font-size:.88rem;color:#667085}.ops-resolution{margin-top:14px;padding-top:14px;border-top:1px solid rgba(0,0,0,.12)}
    .ops-resolution h3{margin-bottom:6px}.ops-checkbox{display:flex!important;align-items:flex-start;gap:8px}.ops-checkbox input{width:auto!important;margin-top:3px}
    .ops-year-controls{display:flex;gap:10px;align-items:end;flex-wrap:wrap}.ops-year-controls label{min-width:220px}
    .ops-danger{color:#a61b1b}.ops-pill{display:inline-block;padding:3px 8px;border-radius:999px;background:#eef2f6;font-size:.78rem;font-weight:700}
    @media(max-width:720px){.ops-status-grid{grid-template-columns:1fr}}
  `;
  document.head.appendChild(style);
}

async function loadStaticMachines() {
  try {
    staticMachines = await fetch('../data/machines.json').then(r => r.json());
  } catch (error) {
    console.warn('[TAD Ops] Could not load static machine fallback', error);
  }
}

function stopSubscriptions() {
  unsubscribers.forEach(fn => {
    try { fn(); } catch {}
  });
  unsubscribers = [];
}

function subscribeManagerData() {
  stopSubscriptions();
  unsubscribers.push(onSnapshot(collection(db, 'machines'), snap => {
    machines = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => String(a.name).localeCompare(String(b.name)));
    renderManagerStatusPanel();
    renderKnowledge();
  }));
  unsubscribers.push(onSnapshot(collection(db, 'machineStatus'), snap => {
    statuses = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderManagerStatusPanel();
  }));
  unsubscribers.push(onSnapshot(collection(db, 'reports'), snap => {
    reports = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderManagerStatusPanel();
  }));
  unsubscribers.push(onSnapshot(collection(db, 'repairs'), snap => {
    repairs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }));
}

function ensureManagerUi() {
  injectStyles();

  const machineView = $('#view-machines');
  if (machineView && !$('#managerStatusPanel')) {
    const panel = document.createElement('article');
    panel.id = 'managerStatusPanel';
    panel.className = 'card';
    panel.innerHTML = `
      <div class="card-head wrap">
        <div><h3>Manager machine status</h3><p>Change the student-facing machine status directly. Status changes are also retained on the machine record for year-end reporting.</p></div>
      </div>
      <div id="managerStatusGrid" class="ops-status-grid"></div>`;
    machineView.insertBefore(panel, machineView.firstChild);
  }

  const nav = $('#nav');
  if (nav && !$('#knowledgeNav')) {
    const btn = document.createElement('button');
    btn.id = 'knowledgeNav';
    btn.className = 'staff-only';
    btn.type = 'button';
    btn.textContent = 'Machine Knowledge';
    const exportButton = [...nav.querySelectorAll('button')].find(b => b.dataset.view === 'export');
    nav.insertBefore(btn, exportButton || null);
    btn.addEventListener('click', showKnowledgeView);
  }

  const main = document.querySelector('main');
  if (main && !$('#view-knowledge')) {
    const section = document.createElement('section');
    section.id = 'view-knowledge';
    section.className = 'view staff-only';
    section.innerHTML = `
      <article class="card">
        <div class="card-head wrap">
          <div><h3>Machine Knowledge &amp; Resources</h3><p>Reusable staff knowledge: known fixes, manuals, settings, safety notes, maintenance schedules, vendor information, part numbers, and operating rules.</p></div>
          <button id="addKnowledgeItem" class="btn primary small" type="button">+ Add resource</button>
        </div>
        <div class="filters"><select id="knowledgeMachineFilter"><option value="All">All machines</option></select><input id="knowledgeSearch" placeholder="Search machine knowledge…"></div>
        <div id="knowledgeList" class="ops-kb-list"></div>
      </article>`;
    const settings = $('#view-settings');
    main.insertBefore(section, settings || null);
    $('#addKnowledgeItem').addEventListener('click', () => knowledgeModal());
    $('#knowledgeMachineFilter').addEventListener('change', renderKnowledge);
    $('#knowledgeSearch').addEventListener('input', renderKnowledge);
  }

  const exportView = $('#view-export');
  if (exportView && !$('#annualReportCard')) {
    const card = document.createElement('article');
    card.id = 'annualReportCard';
    card.className = 'card';
    card.innerHTML = `
      <div class="card-head"><div><h3>Academic-year operations report</h3><p>Generate a printable year-end summary from live reports, close-outs, repairs, downtime, status history, machine knowledge, safety changes, and replacement recommendations.</p></div></div>
      <div class="ops-year-controls">
        <label>Academic year ending<select id="academicYearEnd"></select></label>
        <button id="generateAnnualReport" class="btn primary" type="button">Generate year-end report</button>
        <button id="downloadCloseoutsCsv" class="btn secondary" type="button">Download close-outs CSV</button>
      </div>`;
    exportView.appendChild(card);
    const select = $('#academicYearEnd');
    const now = new Date();
    const defaultEnd = now.getMonth() >= 6 ? now.getFullYear() + 1 : now.getFullYear();
    for (let y = defaultEnd + 1; y >= defaultEnd - 6; y--) {
      const option = document.createElement('option');
      option.value = String(y);
      option.textContent = `${y - 1}–${String(y).slice(-2)} (ends ${y})`;
      if (y === defaultEnd) option.selected = true;
      select.appendChild(option);
    }
    $('#generateAnnualReport').addEventListener('click', generateAnnualReport);
    $('#downloadCloseoutsCsv').addEventListener('click', downloadCloseoutsCsv);
  }

  const staffAccess = $('#view-settings .card:nth-of-type(2) .stack');
  if (staffAccess && !$('#openPricingAdmin')) {
    const link = document.createElement('a');
    link.id = 'openPricingAdmin';
    link.className = 'btn secondary';
    link.href = '../projects/index.html#pricing';
    link.textContent = 'Open Cost Estimator / Pricing';
    staffAccess.appendChild(link);
  }

  updateManagerUiVisibility();
}

function updateManagerUiVisibility() {
  ['#managerStatusPanel', '#knowledgeNav', '#view-knowledge', '#annualReportCard'].forEach(selector => {
    const el = $(selector);
    if (el) el.classList.toggle('hidden', !manager);
  });
}

function showKnowledgeView() {
  if (!manager) return toast('Manager sign-in required');
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  $('#view-knowledge')?.classList.add('active');
  document.querySelectorAll('#nav button').forEach(b => b.classList.remove('active'));
  $('#knowledgeNav')?.classList.add('active');
  if ($('#pageTitle')) $('#pageTitle').textContent = 'Machine Knowledge';
  if ($('#pageSubtitle')) $('#pageSubtitle').textContent = 'Reusable machine fixes, resources, settings, safety notes, and operating knowledge.';
  document.querySelector('.sidebar')?.classList.remove('open');
  renderKnowledge();
}

function renderManagerStatusPanel() {
  const grid = $('#managerStatusGrid');
  if (!grid || !manager) return;
  const list = machines.length ? machines : staticMachines;
  if (!list.length) {
    grid.innerHTML = '<div class="empty">No Firestore machine records are available yet. Seed the machine inventory from Settings first.</div>';
    return;
  }
  grid.innerHTML = list.map(m => {
    const current = statusByMachine(m.id);
    const open = openReportsForMachine(m.id);
    return `
      <div class="ops-status-card" data-machine="${esc(m.id)}">
        <h4>${esc(m.name)}</h4>
        <p>${esc(m.lab || m.category || '')}${m.room ? ` · ${esc(m.room)}` : ''} · ${open.length} open report${open.length === 1 ? '' : 's'}</p>
        <label>Public status
          <select class="ops-machine-status">${PUBLIC_MACHINE_STATUSES.map(s => `<option ${s === current ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select>
        </label>
        <label>Manager note
          <input class="ops-machine-note" maxlength="500" value="${esc(m.statusNote || '')}" placeholder="Optional internal context for this status">
        </label>
        <div class="ops-status-actions"><button class="btn primary small ops-save-status" type="button">Save status</button></div>
      </div>`;
  }).join('');
  grid.querySelectorAll('.ops-save-status').forEach(btn => {
    btn.addEventListener('click', () => saveMachineStatus(btn.closest('[data-machine]')));
  });
}

async function recordMachineStatus(machineId, status, note, reason = 'Manager status update') {
  const open = openReportsForMachine(machineId);
  if (status === 'Operational' && open.length) {
    throw new Error('OPEN_REPORTS');
  }
  if (status === 'Report Pending' && !open.length) {
    throw new Error('NO_OPEN_REPORT');
  }
  const pendingReportId = status === 'Report Pending' ? open[0]?.id || '' : '';
  await setDoc(doc(db, 'machineStatus', machineId), {
    machineId,
    status,
    pendingReportId,
    updatedAt: serverTimestamp()
  });

  const machineRef = doc(db, 'machines', machineId);
  await runTransaction(db, async tx => {
    const snap = await tx.get(machineRef);
    const existingHistory = Array.isArray(snap.data()?.statusHistory) ? snap.data().statusHistory : [];
    const history = [...existingHistory, {
      id: uid(),
      status,
      note: String(note || '').trim(),
      reason,
      changedAt: new Date().toISOString(),
      changedBy: currentUser?.email || ''
    }].slice(-100);
    tx.set(machineRef, {
      statusNote: String(note || '').trim(),
      statusUpdatedAt: serverTimestamp(),
      statusUpdatedBy: currentUser?.email || '',
      statusHistory: history
    }, { merge: true });
  });
}

async function saveMachineStatus(card) {
  if (!manager || !card) return;
  const machineId = card.dataset.machine;
  const status = card.querySelector('.ops-machine-status').value;
  const note = card.querySelector('.ops-machine-note').value.trim();
  try {
    await recordMachineStatus(machineId, status, note);
    toast('Machine status saved');
  } catch (error) {
    if (error.message === 'OPEN_REPORTS') return alert('Resolve the open maintenance report(s) before marking this machine Operational.');
    if (error.message === 'NO_OPEN_REPORT') return alert('Report Pending requires at least one unresolved report for this machine.');
    console.error(error);
    alert('The machine status could not be saved.');
  }
}

function resolutionFields(report) {
  return `
    <div class="ops-resolution">
      <h3>Required close-out record</h3>
      <p class="ops-note">A report cannot be closed as Resolved without an outcome and resolution summary. Use “Report submitted in error” when appropriate.</p>
      <div class="form-grid">
        <label>Outcome<select id="opsOutcome"><option value="">Select outcome…</option>${OUTCOMES.map(v => `<option ${v === report.resolutionOutcome ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>
        <label>Follow-up date<input id="opsFollowUpDate" type="date" value="${esc(report.followUpDate || '')}"></label>
        <label class="full">Resolution summary<textarea id="opsResolutionSummary" rows="3" placeholder="What was the final outcome?">${esc(report.resolutionSummary || '')}</textarea></label>
        <label class="full">Cause / diagnosis<textarea id="opsRootCause" rows="2">${esc(report.rootCause || '')}</textarea></label>
        <label class="full">Work performed / corrective action<textarea id="opsWorkPerformed" rows="2">${esc(report.workPerformed || '')}</textarea></label>
        <label class="full">Helpful links / resources<textarea id="opsHelpfulLinks" rows="2" placeholder="Manual, vendor article, tutorial, part page…">${esc(report.helpfulLinks || '')}</textarea></label>
        <label class="full">Safety or procedure change<textarea id="opsSafetyChange" rows="2" placeholder="Leave blank if none">${esc(report.safetyProcedureChange || '')}</textarea></label>
        <label class="full">New lab rule / operating guideline<textarea id="opsNewRule" rows="2" placeholder="Leave blank if none">${esc(report.newRuleGuideline || '')}</textarea></label>
        <label class="full">Replacement recommendation<textarea id="opsReplacement" rows="2" placeholder="Leave blank if none">${esc(report.replacementRecommendation || '')}</textarea></label>
        <label class="full ops-checkbox"><input id="opsPromoteKnowledge" type="checkbox" ${report.promoteToKnowledge ? 'checked' : ''}><span>Promote this close-out to Machine Knowledge &amp; Resources</span></label>
        <label class="full">Knowledge title<input id="opsKnowledgeTitle" value="${esc(report.knowledgeTitle || '')}" placeholder="Example: Fixing repeated vinyl tracking errors"></label>
      </div>
    </div>`;
}

async function enhancedManageReport(id) {
  if (!manager) return toast('Manager sign-in required');
  let report = reports.find(r => r.id === id);
  if (!report) {
    const snap = await getDoc(doc(db, 'reports', id));
    if (!snap.exists()) return;
    report = { id: snap.id, ...snap.data() };
  }
  const m = machineById(report.machineId);
  const publicStatus = statusByMachine(report.machineId);
  const modal = $('#modal');
  const body = $('#modalBody');
  if (!modal || !body) return;
  body.innerHTML = `
    <h2>${esc(m.name)}</h2>
    <p><span class="ops-pill">${esc(report.urgency || '')}</span> <span class="ops-pill">${esc(report.status || 'Open')}</span></p>
    <p><strong>Issue</strong><br>${esc(report.issue || '')}</p>
    <p><strong>Fixes tried</strong><br>${esc(report.attempted || 'None entered')}</p>
    <p><strong>Contact</strong><br>${esc(report.contact || 'Not provided')}</p>
    <div class="form-grid">
      <label>Workflow status<select id="opsReportStatus"><option>Open</option><option>Diagnosing</option><option>Waiting for Part</option><option>Resolved</option></select></label>
      <label>Public machine status<select id="opsPublicStatus">${PUBLIC_MACHINE_STATUSES.map(s => `<option ${s === publicStatus ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></label>
    </div>
    ${resolutionFields(report)}
    <div class="form-actions">
      <button type="button" class="btn secondary" id="opsAddRepair">Add repair / cost</button>
      <button type="button" class="btn primary" id="opsSaveReport">Save report</button>
    </div>`;
  $('#opsReportStatus').value = report.status || 'Open';
  $('#opsAddRepair').addEventListener('click', () => window.addRepairFor?.(id));
  $('#opsSaveReport').addEventListener('click', () => saveEnhancedReport(report));
  modal.showModal();
}

async function saveEnhancedReport(report) {
  const status = $('#opsReportStatus').value;
  let publicStatus = $('#opsPublicStatus').value;
  const outcome = $('#opsOutcome').value;
  const summary = $('#opsResolutionSummary').value.trim();
  const otherOpen = reports.filter(r => r.machineId === report.machineId && r.id !== report.id && r.status !== 'Resolved');

  if (status === 'Resolved' && !outcome) return alert('Choose a close-out outcome before resolving this report.');
  if (status === 'Resolved' && !summary) return alert('Enter a resolution summary before resolving this report.');

  if (status !== 'Resolved' && publicStatus === 'Operational') publicStatus = 'Report Pending';
  if (status === 'Resolved' && otherOpen.length && publicStatus === 'Operational') publicStatus = 'Report Pending';
  if (status === 'Resolved' && !otherOpen.length) {
    if (outcome === 'Machine retired') publicStatus = 'Out of Service';
    else if (['Temporary workaround', 'Follow-up required'].includes(outcome) && publicStatus === 'Operational') publicStatus = 'Attention';
    else if (['Fixed', 'Report submitted in error', 'User training issue'].includes(outcome)) publicStatus = 'Operational';
  }

  const pendingReportId = publicStatus === 'Report Pending'
    ? (status !== 'Resolved' ? report.id : otherOpen[0]?.id || '')
    : '';

  const payload = {
    status,
    resolutionOutcome: outcome,
    resolutionSummary: summary,
    rootCause: $('#opsRootCause').value.trim(),
    workPerformed: $('#opsWorkPerformed').value.trim(),
    helpfulLinks: $('#opsHelpfulLinks').value.trim(),
    safetyProcedureChange: $('#opsSafetyChange').value.trim(),
    newRuleGuideline: $('#opsNewRule').value.trim(),
    followUpDate: $('#opsFollowUpDate').value,
    replacementRecommendation: $('#opsReplacement').value.trim(),
    promoteToKnowledge: $('#opsPromoteKnowledge').checked,
    knowledgeTitle: $('#opsKnowledgeTitle').value.trim(),
    resolutionUpdatedAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };
  if (status === 'Resolved') {
    payload.resolvedBy = currentUser?.email || '';
    if (!report.resolvedAt) payload.resolvedAt = serverTimestamp();
  }

  await Promise.all([
    updateDoc(doc(db, 'reports', report.id), payload),
    setDoc(doc(db, 'machineStatus', report.machineId), {
      machineId: report.machineId,
      status: publicStatus,
      pendingReportId,
      updatedAt: serverTimestamp()
    })
  ]);

  await appendStatusHistory(report.machineId, publicStatus, status === 'Resolved' ? summary : `Report ${report.id.slice(0, 8)} set to ${status}`,
    status === 'Resolved' ? `Report resolved: ${outcome}` : 'Report workflow update');

  if (status === 'Resolved' && $('#opsPromoteKnowledge').checked) {
    await promoteReportToKnowledge(report, payload);
  }

  $('#modal')?.close();
  toast(status === 'Resolved' ? 'Report resolved with close-out record' : 'Report updated');
}

async function appendStatusHistory(machineId, status, note, reason) {
  const machineRef = doc(db, 'machines', machineId);
  await runTransaction(db, async tx => {
    const snap = await tx.get(machineRef);
    const existing = Array.isArray(snap.data()?.statusHistory) ? snap.data().statusHistory : [];
    const next = [...existing, {
      id: uid(), status, note: String(note || '').trim(), reason,
      changedAt: new Date().toISOString(), changedBy: currentUser?.email || ''
    }].slice(-100);
    tx.set(machineRef, {
      statusNote: String(note || '').trim(),
      statusUpdatedAt: serverTimestamp(),
      statusUpdatedBy: currentUser?.email || '',
      statusHistory: next
    }, { merge: true });
  });
}

async function promoteReportToKnowledge(report, payload) {
  const mRef = doc(db, 'machines', report.machineId);
  await runTransaction(db, async tx => {
    const snap = await tx.get(mRef);
    const items = Array.isArray(snap.data()?.knowledgeResources) ? snap.data().knowledgeResources : [];
    if (items.some(item => item.sourceReportId === report.id)) return;
    const title = payload.knowledgeTitle || `${payload.resolutionOutcome}: ${String(report.issue || '').slice(0, 80)}`;
    const notes = [
      payload.resolutionSummary,
      payload.rootCause ? `Cause: ${payload.rootCause}` : '',
      payload.workPerformed ? `Work performed: ${payload.workPerformed}` : '',
      payload.safetyProcedureChange ? `Safety/procedure: ${payload.safetyProcedureChange}` : '',
      payload.newRuleGuideline ? `Rule/guideline: ${payload.newRuleGuideline}` : ''
    ].filter(Boolean).join('\n\n');
    const item = {
      id: uid(),
      type: payload.safetyProcedureChange ? 'Safety' : 'Known issue solution',
      title,
      url: firstUrl(payload.helpfulLinks),
      notes,
      sourceReportId: report.id,
      createdAt: new Date().toISOString(),
      createdBy: currentUser?.email || ''
    };
    tx.set(mRef, { knowledgeResources: [...items, item] }, { merge: true });
  });
}

function firstUrl(text = '') {
  const match = String(text).match(/https?:\/\/\S+/i);
  return match ? match[0].replace(/[),.;]+$/, '') : '';
}

function installRepairCloseoutGuard() {
  window.saveRepair = async () => {
    if (!manager) return toast('Manager sign-in required');
    const reportId = $('#rReport')?.value || '';
    const machineId = $('#rMachine')?.value || '';
    const resolution = $('#rResolution')?.value.trim() || '';
    if (!resolution) return toast('Please enter the work performed');
    await addDoc(collection(db, 'repairs'), {
      reportId,
      machineId,
      date: serverTimestamp(),
      technician: $('#rTech')?.value.trim() || '',
      resolution,
      part: $('#rPart')?.value.trim() || '',
      partsCost: Number($('#rParts')?.value || 0),
      serviceCost: Number($('#rService')?.value || 0),
      laborHours: Number($('#rHours')?.value || 0),
      downtimeDays: Number($('#rDown')?.value || 0),
      recordType: 'repair',
      createdBy: currentUser?.email || ''
    });
    if (reportId) {
      const reportRef = doc(db, 'reports', reportId);
      const reportSnap = await getDoc(reportRef);
      if (reportSnap.exists() && reportSnap.data()?.status === 'Open') {
        await updateDoc(reportRef, { status: 'Diagnosing', updatedAt: serverTimestamp() });
      }
    }
    $('#modal')?.close();
    toast(reportId ? 'Repair saved. Finish the required close-out from Reports when the issue is resolved.' : 'Repair record saved');
  };
}

function knowledgeModal(machineId = '') {
  if (!manager) return;
  const list = machines.length ? machines : staticMachines;
  const body = $('#modalBody');
  if (!body) return;
  body.innerHTML = `
    <h2>Add Machine Knowledge</h2>
    <div class="form-grid">
      <label class="full">Machine<select id="kbMachine">${list.map(m => `<option value="${esc(m.id)}" ${m.id === machineId ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select></label>
      <label>Type<select id="kbType">${KNOWLEDGE_TYPES.map(v => `<option>${esc(v)}</option>`).join('')}</select></label>
      <label>Title<input id="kbTitle" maxlength="180"></label>
      <label class="full">URL<input id="kbUrl" placeholder="Optional manual, vendor, tutorial, or part URL"></label>
      <label class="full">Notes<textarea id="kbNotes" rows="5" placeholder="Reusable instructions, settings, part number, safety note, schedule, or known fix"></textarea></label>
      <div class="form-actions full"><button id="kbSave" class="btn primary" type="button">Save resource</button></div>
    </div>`;
  $('#kbSave').addEventListener('click', saveKnowledgeItem);
  $('#modal')?.showModal();
}

async function saveKnowledgeItem() {
  const machineId = $('#kbMachine').value;
  const title = $('#kbTitle').value.trim();
  if (!title) return alert('Enter a title for this resource.');
  const mRef = doc(db, 'machines', machineId);
  await runTransaction(db, async tx => {
    const snap = await tx.get(mRef);
    const items = Array.isArray(snap.data()?.knowledgeResources) ? snap.data().knowledgeResources : [];
    items.push({
      id: uid(),
      type: $('#kbType').value,
      title,
      url: $('#kbUrl').value.trim(),
      notes: $('#kbNotes').value.trim(),
      sourceReportId: '',
      createdAt: new Date().toISOString(),
      createdBy: currentUser?.email || ''
    });
    tx.set(mRef, { knowledgeResources: items }, { merge: true });
  });
  $('#modal')?.close();
  toast('Machine knowledge saved');
}

async function deleteKnowledge(machineId, itemId) {
  if (!manager || !confirm('Delete this machine knowledge item?')) return;
  const mRef = doc(db, 'machines', machineId);
  await runTransaction(db, async tx => {
    const snap = await tx.get(mRef);
    const items = (Array.isArray(snap.data()?.knowledgeResources) ? snap.data().knowledgeResources : []).filter(i => i.id !== itemId);
    tx.set(mRef, { knowledgeResources: items }, { merge: true });
  });
  toast('Knowledge item deleted');
}

function renderKnowledge() {
  const listEl = $('#knowledgeList');
  const filter = $('#knowledgeMachineFilter');
  if (!listEl || !filter || !manager) return;
  const list = machines.length ? machines : staticMachines;
  const current = filter.value || 'All';
  filter.innerHTML = '<option value="All">All machines</option>' + list.map(m => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('');
  if ([...filter.options].some(o => o.value === current)) filter.value = current;
  const q = ($('#knowledgeSearch')?.value || '').toLowerCase();
  const rows = list.flatMap(m => (Array.isArray(m.knowledgeResources) ? m.knowledgeResources : []).map(item => ({ machine: m, item })))
    .filter(row => (filter.value === 'All' || row.machine.id === filter.value) && (!q || [row.machine.name, row.item.type, row.item.title, row.item.notes].join(' ').toLowerCase().includes(q)))
    .sort((a, b) => String(a.machine.name).localeCompare(String(b.machine.name)) || String(a.item.title).localeCompare(String(b.item.title)));
  listEl.innerHTML = rows.map(({ machine: m, item }) => `
    <div class="ops-kb-item">
      <div class="ops-kb-meta">${esc(m.name)} · ${esc(item.type || 'Resource')}${item.sourceReportId ? ` · report ${esc(item.sourceReportId.slice(0, 8))}` : ''}</div>
      <h4>${esc(item.title || 'Untitled')}</h4>
      ${item.notes ? `<p>${esc(item.notes).replaceAll('\n', '<br>')}</p>` : ''}
      <div class="ops-kb-actions">
        ${item.url ? `<a class="btn secondary small" href="${esc(item.url)}" target="_blank" rel="noopener">Open resource ↗</a>` : ''}
        <button class="btn secondary small" type="button" data-delete-kb="${esc(m.id)}|${esc(item.id)}">Delete</button>
      </div>
    </div>`).join('') || '<div class="empty">No machine knowledge items match this filter yet.</div>';
  listEl.querySelectorAll('[data-delete-kb]').forEach(btn => {
    const [machineId, itemId] = btn.dataset.deleteKb.split('|');
    btn.addEventListener('click', () => deleteKnowledge(machineId, itemId));
  });
}

function academicWindow(endYear) {
  return {
    start: new Date(endYear - 1, 6, 1, 0, 0, 0, 0),
    end: new Date(endYear, 6, 1, 0, 0, 0, 0)
  };
}
const inWindow = (value, start, end) => {
  const d = toDate(value);
  return !!(d && !Number.isNaN(d.valueOf()) && d >= start && d < end);
};
const totalRepairCost = repair => Number(repair.partsCost || 0) + Number(repair.serviceCost || 0);

function generateAnnualReport() {
  if (!manager) return;
  const endYear = Number($('#academicYearEnd')?.value || new Date().getFullYear());
  const { start, end } = academicWindow(endYear);
  const createdReports = reports.filter(r => inWindow(r.createdAt, start, end));
  const resolvedReports = reports.filter(r => r.status === 'Resolved' && inWindow(r.resolvedAt, start, end));
  const yearRepairs = repairs.filter(r => inWindow(r.date, start, end));
  const totalCost = yearRepairs.reduce((sum, r) => sum + totalRepairCost(r), 0);
  const downtime = yearRepairs.reduce((sum, r) => sum + Number(r.downtimeDays || 0), 0);
  const durations = resolvedReports.map(r => {
    const a = toDate(r.createdAt), b = toDate(r.resolvedAt);
    return a && b ? (b - a) / 86400000 : null;
  }).filter(v => Number.isFinite(v) && v >= 0);
  const meanDays = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;
  const erroneous = resolvedReports.filter(r => r.resolutionOutcome === 'Report submitted in error').length;
  const externalService = yearRepairs.filter(r => Number(r.serviceCost || 0) > 0).length;
  const byMachine = new Map();
  createdReports.forEach(r => byMachine.set(r.machineId, (byMachine.get(r.machineId) || 0) + 1));
  const repeated = [...byMachine.entries()].filter(([, count]) => count > 1).sort((a, b) => b[1] - a[1]);
  const outcomeCounts = new Map();
  resolvedReports.forEach(r => outcomeCounts.set(r.resolutionOutcome || 'Unclassified', (outcomeCounts.get(r.resolutionOutcome || 'Unclassified') || 0) + 1));
  const safety = resolvedReports.filter(r => r.safetyProcedureChange).map(r => ({ machine: machineById(r.machineId).name, text: r.safetyProcedureChange, id: r.id }));
  const rules = resolvedReports.filter(r => r.newRuleGuideline).map(r => ({ machine: machineById(r.machineId).name, text: r.newRuleGuideline, id: r.id }));
  const replacements = resolvedReports.filter(r => r.replacementRecommendation).map(r => ({ machine: machineById(r.machineId).name, text: r.replacementRecommendation, id: r.id }));
  const knowledge = machines.flatMap(m => (Array.isArray(m.knowledgeResources) ? m.knowledgeResources : []).filter(i => inWindow(i.createdAt, start, end)).map(i => ({ machine: m.name, ...i })));
  const statusChanges = machines.flatMap(m => (Array.isArray(m.statusHistory) ? m.statusHistory : []).filter(i => inWindow(i.changedAt, start, end)).map(i => ({ machine: m.name, ...i })));

  const events = [
    ...createdReports.map(r => ({ date: toDate(r.createdAt), type: 'Report submitted', machine: machineById(r.machineId).name, detail: r.issue })),
    ...resolvedReports.map(r => ({ date: toDate(r.resolvedAt), type: `Resolved — ${r.resolutionOutcome || 'Outcome not classified'}`, machine: machineById(r.machineId).name, detail: r.resolutionSummary || '' })),
    ...yearRepairs.map(r => ({ date: toDate(r.date), type: 'Repair / cost', machine: machineById(r.machineId).name, detail: `${r.resolution || ''}${totalRepairCost(r) ? ` · ${money(totalRepairCost(r))}` : ''}` })),
    ...statusChanges.map(s => ({ date: toDate(s.changedAt), type: `Status → ${s.status}`, machine: s.machine, detail: s.note || s.reason || '' }))
  ].filter(e => e.date).sort((a, b) => a.date - b.date);

  const popup = window.open('', '_blank');
  if (!popup) return alert('Allow pop-ups for this site to generate the printable annual report.');
  const listRows = items => items.length ? `<ul>${items.map(i => `<li><strong>${esc(i.machine)}</strong> — ${esc(i.text || i.title || '')}${i.id ? ` <small>(report ${esc(i.id.slice(0, 8))})</small>` : ''}</li>`).join('')}</ul>` : '<p>None recorded.</p>';
  popup.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>TAD Lab Manager ${endYear - 1}-${endYear} Annual Report</title><style>
    body{font-family:Arial,sans-serif;max-width:1050px;margin:36px auto;padding:0 24px;color:#171717}h1,h2{margin-bottom:6px}h2{margin-top:32px;border-bottom:2px solid #222;padding-bottom:6px}.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.stat{border:1px solid #bbb;border-radius:10px;padding:12px}.stat strong{display:block;font-size:1.5rem}table{width:100%;border-collapse:collapse}th,td{text-align:left;border-bottom:1px solid #ddd;padding:7px;vertical-align:top}small{color:#666}.print{position:fixed;right:20px;top:20px;padding:10px 14px}@media print{.print{display:none}.stats{grid-template-columns:repeat(4,1fr)}body{margin:0;max-width:none}}</style></head><body>
    <button class="print" onclick="window.print()">Print / Save PDF</button>
    <h1>TAD Lab Manager — Academic Year ${endYear - 1}–${String(endYear).slice(-2)}</h1><p>Maintenance, machine operations, and cost summary · July 1, ${endYear - 1} through June 30, ${endYear}</p>
    <div class="stats">
      <div class="stat"><strong>${createdReports.length}</strong>Reports submitted</div><div class="stat"><strong>${resolvedReports.length}</strong>Reports resolved</div><div class="stat"><strong>${yearRepairs.length}</strong>Repair events</div><div class="stat"><strong>${money(totalCost)}</strong>Parts + service</div>
      <div class="stat"><strong>${downtime.toFixed(1)}</strong>Downtime days</div><div class="stat"><strong>${meanDays.toFixed(1)}</strong>Mean days to resolution</div><div class="stat"><strong>${erroneous}</strong>Reports in error</div><div class="stat"><strong>${externalService}</strong>External-service events</div>
    </div>
    <h2>Outcome types</h2>${outcomeCounts.size ? `<table><tr><th>Outcome</th><th>Count</th></tr>${[...outcomeCounts.entries()].sort((a,b)=>b[1]-a[1]).map(([name,count])=>`<tr><td>${esc(name)}</td><td>${count}</td></tr>`).join('')}</table>` : '<p>No structured close-outs recorded in this academic year.</p>'}
    <h2>Repeat issues by machine</h2>${repeated.length ? `<table><tr><th>Machine</th><th>Reports</th></tr>${repeated.map(([id,count])=>`<tr><td>${esc(machineById(id).name)}</td><td>${count}</td></tr>`).join('')}</table>` : '<p>No machine had more than one newly submitted report.</p>'}
    <h2>Safety / procedure changes</h2>${listRows(safety)}
    <h2>New operating rules / guidelines</h2>${listRows(rules)}
    <h2>Machine knowledge created</h2>${knowledge.length ? `<ul>${knowledge.map(i=>`<li><strong>${esc(i.machine)}</strong> — ${esc(i.type || 'Resource')}: ${esc(i.title || '')}</li>`).join('')}</ul>` : '<p>None recorded.</p>'}
    <h2>Replacement recommendations</h2>${listRows(replacements)}
    <h2>Chronological maintenance log</h2><table><tr><th>Date</th><th>Machine</th><th>Event</th><th>Detail</th></tr>${events.map(e=>`<tr><td>${esc(dateText(e.date))}</td><td>${esc(e.machine)}</td><td>${esc(e.type)}</td><td>${esc(e.detail)}</td></tr>`).join('')}</table>
    <p><small>Generated from live TAD Lab Manager Firestore records on ${esc(new Date().toLocaleString())}. Existing CSV and JSON exports remain the archival source data.</small></p>
  </body></html>`);
  popup.document.close();
}

function csvCell(value) {
  const text = value == null ? '' : value?.toDate ? value.toDate().toISOString() : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}
function download(name, text) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function downloadCloseoutsCsv() {
  const headers = ['Report ID','Created','Resolved','Machine ID','Machine','Status','Outcome','Resolution Summary','Cause','Work Performed','Helpful Links','Safety / Procedure Change','New Rule / Guideline','Follow-up Date','Replacement Recommendation','Resolved By'];
  const rows = reports.map(r => [r.id,r.createdAt,r.resolvedAt,r.machineId,machineById(r.machineId).name,r.status,r.resolutionOutcome,r.resolutionSummary,r.rootCause,r.workPerformed,r.helpfulLinks,r.safetyProcedureChange,r.newRuleGuideline,r.followUpDate,r.replacementRecommendation,r.resolvedBy]);
  download(`TAD-Lab-closeouts-${new Date().toISOString().slice(0,10)}.csv`, [headers, ...rows].map(row => row.map(csvCell).join(',')).join('\n'));
}

function installOverrides() {
  window.manageReport = enhancedManageReport;
  installRepairCloseoutGuard();
}

onAuthStateChanged(auth, user => {
  currentUser = user;
  manager = isManager(user);
  ensureManagerUi();
  updateManagerUiVisibility();
  if (manager) {
    subscribeManagerData();
    installOverrides();
  } else {
    stopSubscriptions();
    machines = []; reports = []; repairs = []; statuses = [];
  }
});

await loadStaticMachines();
ensureManagerUi();
