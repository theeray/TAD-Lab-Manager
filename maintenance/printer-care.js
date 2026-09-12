import { getApps } from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js';
import {
  getFirestore,
  collection,
  addDoc,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  orderBy,
  limit,
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js';

const STAFF_EMAILS = new Set([
  'eric.carlson.2@bemidjistate.edu',
  'chase.cornell@bemidjistate.edu',
  'andrew.graham@bemidjistate.edu',
  'nick.lowery@bemidjistate.edu'
]);

const EVENT_LABELS = {
  print: 'Production / test print',
  'nozzle-check': 'Nozzle / diagnostic print',
  storage: 'Stored / parked per manufacturer procedure',
  'return-service': 'Returned to active service'
};

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const esc = (value = '') => String(value).replace(/[&<>\"]/g, ch => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'
}[ch]));
const today = () => new Date().toISOString().slice(0, 10);
const parseDate = value => new Date(`${value}T12:00:00`);
const daysSince = value => Math.max(0, Math.floor((Date.now() - parseDate(value).getTime()) / 86400000));

let auth = null;
let db = null;
let currentUser = null;
let isStaff = false;
let profiles = [];
let logs = [];
let unsubscribeLogs = null;

function approvedStaff(user) {
  return !!(
    user?.email &&
    user.emailVerified &&
    user.providerData?.some(provider => provider.providerId === 'password') &&
    STAFF_EMAILS.has(String(user.email).toLowerCase())
  );
}

async function waitForApp() {
  for (let i = 0; i < 120; i += 1) {
    const app = getApps()[0];
    if (app) return app;
    await sleep(100);
  }
  throw new Error('Firebase app did not initialize in time.');
}

function injectStyles() {
  if (document.getElementById('printerCareStyles')) return;
  const style = document.createElement('style');
  style.id = 'printerCareStyles';
  style.textContent = `
    #printerCareSection { margin: 0 0 18px; }
    .printer-care-head { display:flex; justify-content:space-between; gap:16px; align-items:flex-start; flex-wrap:wrap; }
    .printer-care-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(330px,1fr)); gap:14px; margin-top:14px; }
    .printer-care-unit { border:1px solid #d7dde5; border-radius:14px; padding:16px; background:#fff; }
    .printer-care-unit h4 { margin:0; font-size:1.05rem; }
    .printer-care-status { display:inline-flex; align-items:center; gap:7px; border-radius:999px; padding:5px 9px; font-size:.78rem; font-weight:800; margin-top:8px; }
    .printer-care-status.current { background:#e6f7ef; color:#11613e; }
    .printer-care-status.soon { background:#fff6d6; color:#725600; }
    .printer-care-status.overdue { background:#ffe7e4; color:#8c241e; }
    .printer-care-status.stored { background:#e9eef9; color:#29497c; }
    .printer-care-status.unknown { background:#eef1f4; color:#48515d; }
    .printer-care-guidance { margin:12px 0; padding:11px 12px; background:#f7f9fb; border-radius:10px; font-size:.88rem; line-height:1.45; }
    .printer-care-guidance p { margin:0 0 7px; }
    .printer-care-guidance p:last-child { margin-bottom:0; }
    .printer-care-guidance a { font-weight:700; }
    .printer-log-form { display:grid; grid-template-columns:130px minmax(160px,1fr); gap:8px; margin-top:12px; }
    .printer-log-form .wide { grid-column:1 / -1; }
    .printer-log-form input, .printer-log-form select { width:100%; }
    .printer-log-actions { display:flex; gap:8px; justify-content:flex-end; grid-column:1 / -1; }
    .printer-log-history { margin-top:14px; border-top:1px solid #e4e8ee; padding-top:10px; }
    .printer-log-row { display:grid; grid-template-columns:88px 1fr auto; gap:8px; align-items:start; padding:7px 0; border-bottom:1px solid #eef1f4; font-size:.82rem; }
    .printer-log-row:last-child { border-bottom:0; }
    .printer-log-row .meta { color:#697384; font-size:.76rem; margin-top:2px; }
    .printer-care-summary { font-size:.88rem; color:#596476; }
    @media (max-width:680px) {
      .printer-log-form { grid-template-columns:1fr; }
      .printer-log-form .wide, .printer-log-actions { grid-column:1; }
      .printer-log-row { grid-template-columns:78px 1fr; }
      .printer-log-row button { grid-column:2; justify-self:start; }
    }
  `;
  document.head.appendChild(style);
}

function ensureSection() {
  const view = document.getElementById('view-machines');
  const machineCards = document.getElementById('machineCards');
  if (!view || !machineCards) return null;
  let section = document.getElementById('printerCareSection');
  if (section) return section;

  section = document.createElement('article');
  section.id = 'printerCareSection';
  section.className = 'card';
  machineCards.before(section);
  return section;
}

function printerLogs(machineId) {
  return logs
    .filter(log => log.machineId === machineId)
    .slice()
    .sort((a, b) => {
      const dateCompare = String(b.eventDate || '').localeCompare(String(a.eventDate || ''));
      if (dateCompare) return dateCompare;
      const aMillis = a.createdAt?.toMillis?.() || 0;
      const bMillis = b.createdAt?.toMillis?.() || 0;
      return bMillis - aMillis;
    });
}

function statusFor(profile) {
  const entries = printerLogs(profile.machineId);
  const latest = entries[0];

  if (latest?.eventType === 'storage') {
    return {
      cls: 'stored',
      label: 'Stored / parked',
      detail: `Storage status set ${latest.eventDate}. Routine print reminder paused.`
    };
  }

  const latestPrint = entries.find(entry => ['print', 'nozzle-check'].includes(entry.eventType));
  if (!latestPrint) {
    return {
      cls: 'unknown',
      label: latest?.eventType === 'return-service' ? 'Print due now' : 'No print logged',
      detail: latest?.eventType === 'return-service'
        ? 'Printer has returned to service; log a test or production print.'
        : 'Add the most recent print to begin cadence tracking.'
    };
  }

  const elapsed = daysSince(latestPrint.eventDate);
  const target = Number(profile.targetDays || 0);
  const overdue = Number(profile.overdueDays || target || 0);
  const isTadThreshold = profile.cadenceBasis === 'tad-operational';

  if (!overdue) {
    return {
      cls: 'current',
      label: `Last print ${elapsed} day${elapsed === 1 ? '' : 's'} ago`,
      detail: 'Manufacturer does not specify a fixed print interval for this model.'
    };
  }

  if (elapsed >= overdue) {
    return {
      cls: 'overdue',
      label: `Overdue — ${elapsed} days since print`,
      detail: isTadThreshold
        ? `TAD operational threshold: ${overdue} days while active; this is not an HP-prescribed print interval.`
        : `Recommended maximum gap: about ${overdue} days while active.`
    };
  }

  if (elapsed >= target) {
    return {
      cls: 'soon',
      label: `Due soon — ${elapsed} days since print`,
      detail: isTadThreshold
        ? `Approaching TAD's ${overdue}-day operational threshold.`
        : `Approaching the ${overdue}-day maximum active-use gap.`
    };
  }

  return {
    cls: 'current',
    label: `Current — ${elapsed} day${elapsed === 1 ? '' : 's'} since print`,
    detail: isTadThreshold
      ? `Next TAD all-color test print due within about ${Math.max(1, target - elapsed)} day${Math.max(1, target - elapsed) === 1 ? '' : 's'}.`
      : `Next preventive print due within about ${Math.max(1, target - elapsed)} day${Math.max(1, target - elapsed) === 1 ? '' : 's'}.`
  };
}

function renderHistory(profile) {
  const entries = printerLogs(profile.machineId).slice(0, 6);
  if (!entries.length) return '<div class="empty">No print/storage history yet.</div>';

  return entries.map(entry => `
    <div class="printer-log-row">
      <strong>${esc(entry.eventDate || '—')}</strong>
      <div>
        <div>${esc(EVENT_LABELS[entry.eventType] || entry.eventType || 'Event')}</div>
        <div class="meta">${esc(entry.notes || '')}${entry.recordedBy ? `${entry.notes ? ' · ' : ''}${esc(entry.recordedBy)}` : ''}</div>
      </div>
      <button class="text-btn printer-log-delete" data-log-id="${esc(entry.id)}" type="button">Delete</button>
    </div>`).join('');
}

function render() {
  const section = ensureSection();
  if (!section) return;

  section.hidden = !isStaff;
  if (!isStaff) return;

  const overdueCount = profiles.filter(profile => statusFor(profile).cls === 'overdue').length;
  const storedCount = profiles.filter(profile => statusFor(profile).cls === 'stored').length;

  section.innerHTML = `
    <div class="printer-care-head">
      <div>
        <h3>Printer ink-flow & storage log</h3>
        <p class="printer-care-summary">Track the last print for ink-based printers, follow manufacturer guidance, and pause reminders when a printer has been prepared for extended inactivity.</p>
      </div>
      <button type="button" class="btn secondary small" id="printerLogExport">Download printer log CSV</button>
    </div>
    <div class="notice"><strong>Current status:</strong> ${overdueCount} overdue · ${storedCount} stored. “Stored / parked” records that the appropriate model-specific shutdown or storage procedure was completed; it does not mean the ink lines were flushed.</div>
    <div class="printer-care-grid">
      ${profiles.map(profile => {
        const status = statusFor(profile);
        return `
          <section class="printer-care-unit" data-printer-id="${esc(profile.machineId)}">
            <h4>${esc(profile.name)}</h4>
            <div class="printer-care-status ${esc(status.cls)}">${esc(status.label)}</div>
            <div class="printer-care-summary">${esc(status.detail)}</div>

            <div class="printer-care-guidance">
              <p><strong>Official guidance:</strong> ${esc(profile.guidance)}</p>
              <p><strong>Storage:</strong> ${esc(profile.storageGuidance)}</p>
              <p>
                <a href="${esc(profile.sourceUrl)}" target="_blank" rel="noopener">Official guidance source ↗</a>
                ${profile.storageInstructionsUrl ? ` · <a href="${esc(profile.storageInstructionsUrl)}" target="_blank" rel="noopener">Move/store instructions (guide copy) ↗</a>` : ''}
                ${profile.officialManualsUrl ? ` · <a href="${esc(profile.officialManualsUrl)}" target="_blank" rel="noopener">Official ${esc(profile.name)} manuals ↗</a>` : ''}
              </p>
            </div>

            <div class="printer-log-form">
              <label>Date<input class="printer-event-date" type="date" value="${today()}" max="${today()}"></label>
              <label>Event<select class="printer-event-type">
                <option value="print">Production / test print</option>
                <option value="nozzle-check">Nozzle / diagnostic print</option>
                <option value="storage">Stored / parked per manufacturer procedure</option>
                <option value="return-service">Returned to active service</option>
              </select></label>
              <label class="wide">Notes<input class="printer-event-notes" maxlength="1000" placeholder="Optional: media, nozzle result, storage/service details…"></label>
              <div class="printer-log-actions"><button type="button" class="btn primary small printer-log-save">Save log entry</button></div>
            </div>

            <div class="printer-log-history">
              <strong>Recent history</strong>
              ${renderHistory(profile)}
            </div>
          </section>`;
      }).join('')}
    </div>`;

  section.querySelectorAll('.printer-log-save').forEach(button => {
    button.addEventListener('click', () => saveEntry(button.closest('[data-printer-id]')));
  });

  section.querySelectorAll('.printer-log-delete').forEach(button => {
    button.addEventListener('click', () => deleteEntry(button.dataset.logId));
  });

  document.getElementById('printerLogExport')?.addEventListener('click', exportCsv);
}

async function saveEntry(card) {
  if (!isStaff || !currentUser?.email || !card) return;
  const machineId = card.dataset.printerId;
  const profile = profiles.find(item => item.machineId === machineId);
  if (!profile) return;

  const eventDate = card.querySelector('.printer-event-date')?.value || '';
  const eventType = card.querySelector('.printer-event-type')?.value || '';
  const notes = card.querySelector('.printer-event-notes')?.value.trim() || '';

  if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) {
    alert('Choose a valid event date.');
    return;
  }

  try {
    await addDoc(collection(db, 'printerLogs'), {
      machineId,
      eventType,
      eventDate,
      notes,
      createdAt: serverTimestamp(),
      recordedBy: currentUser.email
    });
  } catch (error) {
    console.error('[TAD Lab Manager] Printer log save failed', error);
    alert('Printer log entry could not be saved.');
  }
}

async function deleteEntry(logId) {
  if (!isStaff || !logId) return;
  if (!confirm('Delete this printer log entry?')) return;
  try {
    await deleteDoc(doc(db, 'printerLogs', logId));
  } catch (error) {
    console.error('[TAD Lab Manager] Printer log deletion failed', error);
    alert('Printer log entry could not be deleted.');
  }
}

function csvCell(value) {
  return `"${String(value ?? '').replaceAll('"', '""')}"`;
}

function exportCsv() {
  const rows = [['Date', 'Machine ID', 'Printer', 'Event', 'Notes', 'Recorded By']];
  logs
    .slice()
    .sort((a, b) => String(b.eventDate || '').localeCompare(String(a.eventDate || '')))
    .forEach(entry => {
      const profile = profiles.find(item => item.machineId === entry.machineId);
      rows.push([
        entry.eventDate,
        entry.machineId,
        profile?.name || entry.machineId,
        EVENT_LABELS[entry.eventType] || entry.eventType,
        entry.notes || '',
        entry.recordedBy || ''
      ]);
    });

  const blob = new Blob([rows.map(row => row.map(csvCell).join(',')).join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `TAD-Printer-Log-${today()}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function startLogSubscription() {
  if (unsubscribeLogs) return;
  const logQuery = query(collection(db, 'printerLogs'), orderBy('createdAt', 'desc'), limit(500));
  unsubscribeLogs = onSnapshot(logQuery, snapshot => {
    logs = snapshot.docs.map(snapshotDoc => ({ id: snapshotDoc.id, ...snapshotDoc.data() }));
    render();
  }, error => {
    console.error('[TAD Lab Manager] Printer log subscription failed', error);
    logs = [];
    render();
  });
}

async function init() {
  injectStyles();
  profiles = await fetch('../data/printer-care.json').then(response => {
    if (!response.ok) throw new Error(`Printer care profile load failed: ${response.status}`);
    return response.json();
  });

  ensureSection();
  render();

  const app = await waitForApp();
  auth = getAuth(app);
  db = getFirestore(app);

  onAuthStateChanged(auth, async user => {
    currentUser = user;
    isStaff = approvedStaff(user);

    if (isStaff) {
      await startLogSubscription();
    } else if (unsubscribeLogs) {
      unsubscribeLogs();
      unsubscribeLogs = null;
      logs = [];
    }

    render();
  });
}

init().catch(error => {
  console.error('[TAD Lab Manager] Printer care log failed to initialize', error);
});
