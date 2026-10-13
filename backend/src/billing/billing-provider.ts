import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { env } from '../config/env';
import { fetchJson } from '../common/utils/resilience';
import { hmacSha256Hex, safeEqual } from '../common/utils/crypto';
import { ValidationError } from '../common/errors/app-error';

export interface CheckoutRequest {
  organizationId: string;
  planKey: string;
  interval: 'MONTHLY' | 'YEARLY';
  priceId: string | null;
  customerEmail: string;
  customerId: string | null;
  successUrl: string;
  cancelUrl: string;
}

/** One-off payment (appointment deposits, overage invoices). */
export interface PaymentLinkRequest {
  amountCents: number;
  currency: string;
  description: string;
  successUrl: string;
  cancelUrl: string;
  customerEmail?: string | null;
  metadata: Record<string, string>;
}

export interface BillingEvent {
  id: string;
  type: string;
  data: Record<string, unknown>;
}

/** Payment-processor port. Business logic never talks to Stripe directly. */
export interface BillingProvider {
  readonly name: 'mock' | 'stripe';
  createCheckoutSession(req: CheckoutRequest): Promise<{ url: string; sessionId: string; completedImmediately: boolean }>;
  createPortalSession(customerId: string, returnUrl: string): Promise<{ url: string }>;
  cancelSubscription(externalSubscriptionId: string): Promise<void>;
  /** Hosted payment page for a one-off amount. `simulated` = no real processor (the app shows its own page). */
  createPaymentLink(req: PaymentLinkRequest): Promise<{ url: string; reference: string; simulated: boolean }>;
  verifyWebhook(rawBody: Buffer, signatureHeader: string | undefined): BillingEvent;
}

/** Local/dev provider: checkout completes instantly so the whole billing flow is demoable without Stripe. */
export class MockBillingProvider implements BillingProvider {
  readonly name = 'mock' as const;

  async createCheckoutSession(req: CheckoutRequest) {
    const sessionId = `mock_cs_${randomUUID()}`;
    return { url: `${req.successUrl}${req.successUrl.includes('?') ? '&' : '?'}session_id=${sessionId}`, sessionId, completedImmediately: true };
  }
  async createPortalSession(_customerId: string, returnUrl: string) {
    return { url: returnUrl };
  }
  async cancelSubscription(): Promise<void> {
    /* nothing to call */
  }
  async createPaymentLink(req: PaymentLinkRequest) {
    // No processor: the patient lands on the app's own action page, which offers a clearly labelled simulated payment.
    return { url: req.cancelUrl, reference: `mock_pay_${randomUUID()}`, simulated: true };
  }
  verifyWebhook(rawBody: Buffer): BillingEvent {
    return JSON.parse(rawBody.toString('utf8')) as BillingEvent;
  }
}

/** Stripe adapter over the REST API (no SDK dependency). */
export class StripeBillingProvider implements BillingProvider {
  readonly name = 'stripe' as const;
  private readonly logger = new Logger(StripeBillingProvider.name);

  constructor(
    private readonly secretKey: string,
    private readonly webhookSecret: string | undefined,
  ) {}

  private async post<T>(path: string, params: Record<string, string>): Promise<T> {
    return fetchJson<T>(`https://api.stripe.com/v1/${path}`, {
      method: 'POST',
      service: 'Stripe',
      headers: { Authorization: `Bearer ${this.secretKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params).toString(),
    });
  }

  async createCheckoutSession(req: CheckoutRequest) {
    if (!req.priceId) throw new ValidationError(`Plan ${req.planKey} has no Stripe price configured for ${req.interval}`);
    const params: Record<string, string> = {
      mode: 'subscription',
      'line_items[0][price]': req.priceId,
      'line_items[0][quantity]': '1',
      success_url: `${req.successUrl}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: req.cancelUrl,
      client_reference_id: req.organizationId,
      'metadata[organizationId]': req.organizationId,
      'metadata[planKey]': req.planKey,
      'metadata[interval]': req.interval,
      'subscription_data[metadata][organizationId]': req.organizationId,
      'subscription_data[metadata][planKey]': req.planKey,
    };
    if (req.customerId) params.customer = req.customerId;
    else params.customer_email = req.customerEmail;
    const session = await this.post<{ id: string; url: string }>('checkout/sessions', params);
    return { url: session.url, sessionId: session.id, completedImmediately: false };
  }

  async createPortalSession(customerId: string, returnUrl: string) {
    const s = await this.post<{ url: string }>('billing_portal/sessions', { customer: customerId, return_url: returnUrl });
    return { url: s.url };
  }

  async cancelSubscription(externalSubscriptionId: string): Promise<void> {
    await this.post(`subscriptions/${externalSubscriptionId}`, { cancel_at_period_end: 'true' });
  }

  async createPaymentLink(req: PaymentLinkRequest) {
    const params: Record<string, string> = {
      mode: 'payment',
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': req.currency.toLowerCase(),
      'line_items[0][price_data][unit_amount]': String(req.amountCents),
      'line_items[0][price_data][product_data][name]': req.description.slice(0, 120),
      success_url: req.successUrl,
      cancel_url: req.cancelUrl,
    };
    for (const [k, v] of Object.entries(req.metadata)) {
      params[`metadata[${k}]`] = v;
      params[`payment_intent_data[metadata][${k}]`] = v;
    }
    if (req.customerEmail) params.customer_email = req.customerEmail;
    const session = await this.post<{ id: string; url: string }>('checkout/sessions', params);
    return { url: session.url, reference: session.id, simulated: false };
  }

  /** Implements Stripe's `Stripe-Signature` scheme: t=<ts>,v1=<hmac(t.payload)>, 5-minute tolerance. */
  verifyWebhook(rawBody: Buffer, header: string | undefined): BillingEvent {
    if (!this.webhookSecret) throw new ValidationError('STRIPE_WEBHOOK_SECRET is not configured');
    if (!header) throw new ValidationError('Missing Stripe-Signature header');
    const parts = Object.fromEntries(header.split(',').map((p) => p.split('=') as [string, string]));
    const t = Number(parts.t);
    if (!t || Math.abs(Date.now() / 1000 - t) > 300) throw new ValidationError('Stripe signature timestamp outside tolerance');
    const expected = hmacSha256Hex(this.webhookSecret, `${t}.${rawBody.toString('utf8')}`);
    const signatures = header
      .split(',')
      .filter((p) => p.startsWith('v1='))
      .map((p) => p.slice(3));
    if (!signatures.some((s) => safeEqual(s, expected))) {
      this.logger.warn('Rejected Stripe webhook with invalid signature');
      throw new ValidationError('Invalid Stripe signature');
    }
    const event = JSON.parse(rawBody.toString('utf8')) as { id: string; type: string; data: { object: Record<string, unknown> } };
    return { id: event.id, type: event.type, data: event.data.object };
  }
}

@Injectable()
export class BillingProviderFactory {
  private instance: BillingProvider | null = null;

  get(): BillingProvider {
    if (!this.instance) {
      const key = env().STRIPE_SECRET_KEY;
      this.instance = key ? new StripeBillingProvider(key, env().STRIPE_WEBHOOK_SECRET) : new MockBillingProvider();
    }
    return this.instance;
  }
}
