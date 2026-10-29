const { test } = require('node:test');
const assert = require('node:assert/strict');
const now = Date.parse('2026-10-29T14:00:00Z');
const events = [
  { id: '1', loanId: 'one', sequence: 1, eventType: 'checkout', assetNumber: '1982096', borrowerName: 'First Student', borrowerEmail: 'first@example.test', course: 'Raster Art', createdAt: '2026-10-28T04:30:00Z' },
  { id: '2', loanId: 'two', previousLoanId: 'one', sequence: 2, eventType: 'renewal', assetNumber: '1982096', borrowerName: 'First Student', course: 'Vector Art', createdAt: '2026-10-28T15:00:00Z' },
  { id: '3', loanId: 'two', sequence: 3, eventType: 'return', assetNumber: '1982096', borrowerName: 'First Student', createdAt: '2026-10-29T12:00:00Z' },
  { id: '4', loanId: 'three', sequence: 4, eventType: 'checkout', assetNumber: '1982096', borrowerName: 'Second Student', borrowerEmail: 'SECOND@example.test', course: 'Mech Design', createdAt: '2026-10-29T13:00:00Z' },
];
const active = [{ id: 'three', status: 'checked-out', renewalDueAt: new Date(now - 1).toISOString() }];
test('search combines words across borrower, asset and course without mutating saved records', async () => {
  const { eventViews, filterHistory } = await import('../../checkout/history-view.mjs');
  const views = eventViews(events, active);
  assert.equal(filterHistory(views, { query: '1982096 SECOND Mech' }, now)[0].id, '4');
  assert.equal(filterHistory(views, { query: 'nobody' }, now).length, 0);
  assert.equal(events[0].status, undefined);
  assert.equal(views[0].currentLoan.status, 'renewed');
  assert.equal(views[1].currentLoan.status, 'returned');
});
test('date, event, active/overdue status and ordering filters match Central Time records', async () => {
  const { eventViews, filterHistory } = await import('../../checkout/history-view.mjs');
  const views = eventViews(events, active);
  assert.deepEqual(filterHistory(views, { from: '2026-10-28', to: '2026-10-28' }, now).map(e => e.id), ['2']);
  assert.deepEqual(filterHistory(views, { state: 'overdue' }, now).map(e => e.id), ['4']);
  assert.deepEqual(filterHistory(views, { eventType: 'return' }, now).map(e => e.id), ['3']);
  assert.deepEqual(filterHistory(views, { state: 'checked-out' }, now).map(e => e.id), ['4']);
  assert.deepEqual(filterHistory(views, { state: 'returned', order: 'oldest' }, now).map(e => e.id), ['2', '3']);
  assert.equal(views.filter(e => e.canReturn).length, 1);
});
