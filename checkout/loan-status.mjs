const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
export function loanStatus(loan, now = Date.now()) {
  if (loan.status === 'returned') return { state: 'closed', icon: '✓', label: 'Returned', needsCheckout: false };
  if (loan.status === 'renewed') return { state: 'closed', icon: '↻', label: 'Re-checked out', needsCheckout: false };
  const due = Date.parse(loan.renewalDueAt || '');
  if (!Number.isFinite(due)) return { state: 'unknown', icon: '?', label: 'Date needs review', needsCheckout: false };
  if (now >= due) return { state: 'overdue', icon: '!', label: 'Re-checkout required', needsCheckout: true };
  if (due - now <= WEEK_MS) return { state: 'soon', icon: '◷', label: 'Due within 7 days', needsCheckout: false };
  return { state: 'current', icon: '✓', label: 'Current · under 8 weeks', needsCheckout: false };
}
