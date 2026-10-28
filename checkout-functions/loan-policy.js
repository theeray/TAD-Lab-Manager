'use strict';
const CHECKOUT_DAYS = 56;
const DAY_MS = 24 * 60 * 60 * 1000;
function asDate(value) {
  const parsed = value?.toDate ? value.toDate() : value instanceof Date ? value : new Date(value || NaN);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}
function deadline(loan) {
  // Legacy records use their original checkout timestamp, never the old editable return date.
  const explicit = asDate(loan.renewalDueAt);
  if (explicit) return explicit;
  const start = asDate(loan.cycleStartedAt || loan.checkoutAt || loan.createdAt);
  return start ? new Date(start.getTime() + CHECKOUT_DAYS * DAY_MS) : null;
}
function newDeadline(start) { return new Date(start.getTime() + CHECKOUT_DAYS * DAY_MS); }
function loanView(loan) { return { ...loan, renewalDueAt: deadline(loan)?.toISOString() || null }; }
module.exports = { CHECKOUT_DAYS, DAY_MS, deadline, newDeadline, loanView };
