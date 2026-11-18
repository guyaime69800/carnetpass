import test from 'node:test';
import assert from 'node:assert/strict';
import { recoverSubscriptionEvents } from './stripe-live-reconciliation.js';

test('recovers only linked live events and keeps receipt idempotency', async () => {
  const stored = new Set();
  const receipts = [];
  const db = { from: () => ({ select: async () => ({ data: [{ subscription_id: 'sub_known' }] }) }),
    rpc: async (_, { receipt }) => { receipts.push(receipt); const duplicate = stored.has(receipt.event_id); stored.add(receipt.event_id); return { data: duplicate ? 'duplicate' : 'recorded' }; } };
  const event = { object: 'event', id: 'evt_good', type: 'customer.subscription.updated', livemode: true, created: 1000, data: { object: { id: 'sub_known' } } };
  const stripe = async path => path === 'account' ? { id: 'acct_expected' } : { data: [event, { ...event, id: 'evt_other', data: { object: { id: 'sub_foreign' } } }, { ...event, id: 'evt_test', livemode: false }], has_more: true };
  assert.deepEqual(await recoverSubscriptionEvents(db, stripe, 2000000, { STRIPE_EXPECTED_ACCOUNT_ID: 'acct_expected' }), { recovered: 1, scanTruncated: true });
  assert.equal((await recoverSubscriptionEvents(db, stripe, 2000000, { STRIPE_EXPECTED_ACCOUNT_ID: 'acct_expected' })).recovered, 0);
  assert.equal(receipts.length, 2);
  assert.equal(receipts[0].object_id, 'sub_known');
});

test('wrong Stripe account cannot write receipts', async () => {
  await assert.rejects(recoverSubscriptionEvents({}, async () => ({ id: 'acct_foreign' }), Date.now(), { STRIPE_EXPECTED_ACCOUNT_ID: 'acct_expected' }), /mismatch/);
});
