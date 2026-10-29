import { loanStatus } from './loan-status.mjs';
const localDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' });
const fold = value => String(value ?? '').normalize('NFKC').toLocaleLowerCase('en-US');
export function eventViews(events, activeLoans) {
  const active = new Map(activeLoans.map(loan => [loan.id, loan]));
  const returned = new Set(events.filter(event => event.eventType === 'return').map(event => event.loanId));
  const renewed = new Set(events.filter(event => event.eventType === 'renewal').map(event => event.previousLoanId));
  return events.map(event => {
    const currentLoan = event.eventType === 'return' ? { ...event, status: 'returned' }
      : active.get(event.loanId) || { ...event, status: returned.has(event.loanId) ? 'returned' : renewed.has(event.loanId) ? 'renewed' : 'closed' };
    return { ...event, currentLoan, canReturn: event.eventType !== 'return' && active.has(event.loanId) };
  });
}
export function filterHistory(views, filters = {}, now = Date.now()) {
  const words = fold(filters.query).trim().split(/\s+/).filter(Boolean);
  return views.filter(event => {
    if (filters.eventType && filters.eventType !== 'all' && event.eventType !== filters.eventType) return false;
    const state = filters.state || 'all';
    const status = loanStatus(event.currentLoan, now);
    if (state === 'checked-out' && event.currentLoan.status !== 'checked-out') return false;
    if (state === 'soon' && status.state !== 'soon') return false;
    if (state === 'overdue' && status.state !== 'overdue') return false;
    if (['returned', 'renewed'].includes(state) && event.currentLoan.status !== state) return false;
    if (filters.from || filters.to) {
      const date = new Date(event.createdAt);
      if (!Number.isFinite(date.getTime())) return false;
      const day = localDay.format(date);
      if (filters.from && day < filters.from || filters.to && day > filters.to) return false;
    }
    const text = fold([event.assetNumber, event.assetId, event.assetLabel, event.borrowerName, event.borrowerEmail, event.course, event.purpose].join(' '));
    return words.every(word => text.includes(word));
  }).sort((a, b) => filters.order === 'oldest' ? a.sequence - b.sequence : b.sequence - a.sequence);
}
