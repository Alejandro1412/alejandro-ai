import { hmacSha256Hex } from '../common/utils/crypto';
import { MockBillingProvider, StripeBillingProvider } from './billing-provider';

describe('StripeBillingProvider.verifyWebhook', () => {
  const secret = 'whsec_test';
  const provider = new StripeBillingProvider('sk_test_x', secret);
  const body = Buffer.from(JSON.stringify({ id: 'evt_1', type: 'invoice.paid', data: { object: { id: 'in_1', subscription: 'sub_1' } } }));
  const header = (ts: number, key = secret) => `t=${ts},v1=${hmacSha256Hex(key, `${ts}.${body.toString('utf8')}`)}`;
  const now = () => Math.floor(Date.now() / 1000);

  it('accepts a correctly signed, fresh event and unwraps data.object', () => {
    expect(provider.verifyWebhook(body, header(now()))).toEqual({ id: 'evt_1', type: 'invoice.paid', data: { id: 'in_1', subscription: 'sub_1' } });
  });

  it('rejects wrong secrets, stale timestamps and missing headers', () => {
    expect(() => provider.verifyWebhook(body, header(now(), 'whsec_other'))).toThrow(/signature/i);
    expect(() => provider.verifyWebhook(body, header(now() - 3600))).toThrow(/tolerance/i);
    expect(() => provider.verifyWebhook(body, undefined)).toThrow();
  });

  it('refuses to verify when no webhook secret is configured', () => {
    expect(() => new StripeBillingProvider('sk_test_x', undefined).verifyWebhook(body, header(now()))).toThrow(/STRIPE_WEBHOOK_SECRET/);
  });
});

describe('MockBillingProvider', () => {
  it('completes checkout immediately so plans can be tested without Stripe', async () => {
    const r = await new MockBillingProvider().createCheckoutSession({
      organizationId: 'org',
      planKey: 'PROFESSIONAL',
      interval: 'MONTHLY',
      priceId: null,
      customerEmail: 'a@b.co',
      customerId: null,
      successUrl: 'http://x/ok',
      cancelUrl: 'http://x/no',
    });
    expect(r.completedImmediately).toBe(true);
  });
});
