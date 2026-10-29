const { test } = require('node:test');
const assert = require('node:assert/strict');
const { deadline, newDeadline } = require('../loan-policy');
const start = new Date('2026-10-28T15:00:00Z');
const due = newDeadline(start).getTime();
const loan = { status: 'checked-out', renewalDueAt: new Date(due).toISOString() };
test('icons change at the final-week and exact 56-day boundaries', async () => {
  const { loanStatus } = await import('../../checkout/loan-status.mjs');
  assert.equal(loanStatus(loan, due - 7 * 86400000 - 1).state, 'current');
  assert.equal(loanStatus(loan, due - 7 * 86400000).state, 'soon');
  assert.equal(loanStatus(loan, due - 1).needsCheckout, false);
  assert.equal(loanStatus(loan, due).state, 'overdue');
  assert.equal(loanStatus(loan, due).needsCheckout, true);
  for (const status of ['returned', 'renewed']) {
    assert.equal(loanStatus({ ...loan, status }, due + 86400000).state, 'closed');
    assert.equal(loanStatus({ ...loan, status }, due + 86400000).needsCheckout, false);
  }
  assert.equal(loanStatus({ status: 'checked-out' }, due).state, 'unknown');
});
test('the eight-week duration stays 56 days across daylight saving and legacy return events use checkout time', () => {
  assert.equal(due - start.getTime(), 56 * 86400000);
  assert.equal(deadline({ checkoutAt: start, createdAt: new Date('2027-01-01Z') }).getTime(), due);
  assert.equal(deadline({ createdAt: start.toISOString(), dueDate: '2099-01-01' }).getTime(), due);
  assert.equal(deadline({}), null);
});
