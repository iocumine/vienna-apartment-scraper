import { describe, it, expect } from 'vitest';
import { detectBelowMarket, ALERT_TYPE_BELOW_MARKET } from '../src/alerts/rules.js';
import { formatAlertText, formatAlertHtml, eur, pct, escapeHtml } from '../src/alerts/format.js';
import { createEmailer } from '../src/alerts/email.js';
import { notifyBelowMarket } from '../src/alerts/notify.js';
import type { Repository } from '../src/db/index.js';
import type { AppConfig, NormalizedListing } from '../src/types.js';

function listing(over: Partial<NormalizedListing> = {}): NormalizedListing {
  return {
    id: 'a1',
    title: 'Flat',
    url: 'https://willhaben.at/1',
    district: 7,
    postcode: 1070,
    rooms: 2,
    area_m2: 50,
    price: 850,
    price_per_m2: 17,
    lat: 48.2,
    lng: 16.3,
    published_at: null,
    ...over,
  };
}

describe('detectBelowMarket', () => {
  it('triggers when sufficiently below the baseline', () => {
    const r = detectBelowMarket({ price_per_m2: 17 }, 20, 0.15);
    expect(r.triggered).toBe(true);
    expect(r.deltaPct).toBeCloseTo(0.15);
  });

  it('does not trigger when only slightly below', () => {
    const r = detectBelowMarket({ price_per_m2: 19 }, 20, 0.15);
    expect(r.triggered).toBe(false);
  });

  it('does not trigger above baseline', () => {
    expect(detectBelowMarket({ price_per_m2: 25 }, 20, 0.15).triggered).toBe(false);
  });

  it('handles missing baseline or price safely', () => {
    expect(detectBelowMarket({ price_per_m2: null }, 20, 0.15).triggered).toBe(false);
    expect(detectBelowMarket({ price_per_m2: 17 }, null, 0.15).triggered).toBe(false);
    expect(detectBelowMarket({ price_per_m2: 17 }, 0, 0.15).triggered).toBe(false);
  });
});

describe('format helpers', () => {
  it('formats currency and percentages', () => {
    expect(eur(1000)).toContain('1');
    expect(eur(null)).toBe('n/a');
    expect(pct(0.153)).toBe('15.3%');
    expect(pct(null)).toBe('n/a');
  });

  it('escapes html', () => {
    expect(escapeHtml('<b>&"')).toBe('&lt;b&gt;&amp;&quot;');
  });

  it('produces text and html alerts', () => {
    const r = detectBelowMarket({ price_per_m2: 17 }, 20, 0.15);
    const text = formatAlertText(listing(), r);
    expect(text).toContain('Below-market');
    expect(text).toContain('District 7');
    const html = formatAlertHtml(listing(), r);
    expect(html).toContain('<h2>');
    expect(html).toContain('View listing');
  });
});

describe('createEmailer', () => {
  it('sends via the injected transport with a from address', async () => {
    const sent: Record<string, unknown>[] = [];
    const transport = {
      sendMail: async (opts: Record<string, unknown>) => {
        sent.push(opts);
        return { ok: true };
      },
    };
    const emailer = createEmailer(
      { host: 'h', port: 1, secure: true, user: 'me@x.com', pass: 'p', from: 'me@x.com' },
      { transport },
    );
    await emailer.send({ to: 'you@x.com', subject: 's', text: 't', html: '<p>t</p>' });
    expect(sent[0]).toMatchObject({ from: 'me@x.com', to: 'you@x.com', subject: 's' });
  });

  it('passes an array of recipients through to the transport', async () => {
    const sent: Record<string, unknown>[] = [];
    const emailer = createEmailer(
      { host: 'h', port: 1, secure: true, user: 'me@x.com', pass: 'p', from: 'me@x.com' },
      { transport: { sendMail: async (o) => { sent.push(o); return {}; } } },
    );
    await emailer.send({ to: ['a@x.com', 'b@y.com'], subject: 's', text: 't' });
    expect(sent[0]!.to).toEqual(['a@x.com', 'b@y.com']);
  });

  it('rejects when recipient is missing', async () => {
    const emailer = createEmailer(
      { host: 'h', port: 1, secure: true, user: '', pass: '', from: '' },
      { transport: { sendMail: async () => ({}) } },
    );
    await expect(emailer.send({ to: '', subject: 's', text: 't' })).rejects.toThrow(/recipient/);
    await expect(emailer.send({ to: [], subject: 's', text: 't' })).rejects.toThrow(/recipient/);
  });
});

// Minimal fake repository for the notify orchestration.
function fakeRepo(baseline: number | null): Repository {
  const sentAlerts = new Set<string>();
  return {
    hasAlertBeenSent: (id: string, type: string) => sentAlerts.has(`${id}:${type}`),
    recordAlertSent: (id: string, type: string) => sentAlerts.add(`${id}:${type}`),
    getDistrictBaseline: () => baseline,
  } as unknown as Repository;
}

const cfg = {
  alertThresholdPct: 0.15,
  statsWindowDays: 30,
  alertEmailTo: ['you@x.com'],
} as AppConfig;

describe('notifyBelowMarket', () => {
  it('sends email and dedups below-market listings', async () => {
    const repo = fakeRepo(20);
    const emails: unknown[] = [];
    const email = { send: async (m: unknown) => { emails.push(m); } };
    const cheap = listing({ id: 'cheap', price_per_m2: 16 });
    const fired = await notifyBelowMarket({ repo, config: cfg, listings: [cheap], email });
    expect(fired).toHaveLength(1);
    expect(emails).toHaveLength(1);
    expect(repo.hasAlertBeenSent('cheap', ALERT_TYPE_BELOW_MARKET)).toBe(true);

    // Second pass: already alerted -> nothing fires.
    const again = await notifyBelowMarket({ repo, config: cfg, listings: [cheap], email });
    expect(again).toHaveLength(0);
    expect(emails).toHaveLength(1);
  });

  it('batches all below-market hits from one round into a single email', async () => {
    const repo = fakeRepo(20);
    const emails: Array<{ text: string }> = [];
    const email = { send: async (m: { text: string }) => { emails.push(m); } };
    const cheapA = listing({ id: 'a', title: 'Flat A', price_per_m2: 16 });
    const cheapB = listing({ id: 'b', title: 'Flat B', price_per_m2: 12 });
    const fired = await notifyBelowMarket({ repo, config: cfg, listings: [cheapA, cheapB], email });
    expect(fired).toHaveLength(2);
    expect(emails).toHaveLength(1); // one combined email, not one per listing
    expect(emails[0]!.text).toContain('Flat A');
    expect(emails[0]!.text).toContain('Flat B');
    expect(repo.hasAlertBeenSent('a', ALERT_TYPE_BELOW_MARKET)).toBe(true);
    expect(repo.hasAlertBeenSent('b', ALERT_TYPE_BELOW_MARKET)).toBe(true);
  });

  it('sends the alert to every configured recipient', async () => {
    const repo = fakeRepo(20);
    const sent: Array<{ to: string | string[] }> = [];
    const email = { send: async (m: { to: string | string[] }) => { sent.push(m); } };
    const multiCfg = { ...cfg, alertEmailTo: ['a@x.com', 'b@y.com'] } as AppConfig;
    const fired = await notifyBelowMarket({
      repo,
      config: multiCfg,
      listings: [listing({ id: 'cheap', price_per_m2: 16 })],
      email,
    });
    expect(fired).toHaveLength(1);
    expect(sent[0]!.to).toEqual(['a@x.com', 'b@y.com']);
  });

  it('ignores listings that are not below market or lack a district', async () => {
    const repo = fakeRepo(20);
    const email = { send: async () => {} };
    const fired = await notifyBelowMarket({
      repo,
      config: cfg,
      listings: [listing({ id: 'ok', price_per_m2: 19 }), listing({ id: 'nodist', district: null, price_per_m2: 1 })],
      email,
    });
    expect(fired).toHaveLength(0);
  });

  it('does not record when the email send fails', async () => {
    const repo = fakeRepo(20);
    const warns: string[] = [];
    const email = { send: async () => { throw new Error('smtp down'); } };
    const fired = await notifyBelowMarket({
      repo,
      config: cfg,
      listings: [listing({ id: 'cheap', price_per_m2: 10 })],
      email,
      logger: { warn: (m: unknown) => warns.push(String(m)) },
    });
    expect(fired).toHaveLength(0);
    expect(repo.hasAlertBeenSent('cheap', ALERT_TYPE_BELOW_MARKET)).toBe(false);
    expect(warns.some((w) => w.includes('email alert failed'))).toBe(true);
  });
});
