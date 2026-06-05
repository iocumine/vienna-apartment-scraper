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

  it('rejects when recipient is missing', async () => {
    const emailer = createEmailer(
      { host: 'h', port: 1, secure: true, user: '', pass: '', from: '' },
      { transport: { sendMail: async () => ({}) } },
    );
    await expect(emailer.send({ to: '', subject: 's', text: 't' })).rejects.toThrow(/recipient/);
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
  alertEmailTo: 'you@x.com',
  whatsapp: { enabled: true, to: '4366012345', authDir: '' },
} as AppConfig;

describe('notifyBelowMarket', () => {
  it('sends email + whatsapp and dedups below-market listings', async () => {
    const repo = fakeRepo(20);
    const emails: unknown[] = [];
    const whats: unknown[] = [];
    const email = { send: async (m: unknown) => { emails.push(m); } };
    const whatsapp = {
      send: async (n: string, t: string) => { whats.push({ n, t }); },
      close: async () => {},
      enabled: true,
    };
    const cheap = listing({ id: 'cheap', price_per_m2: 16 });
    const fired = await notifyBelowMarket({ repo, config: cfg, listings: [cheap], email, whatsapp });
    expect(fired).toHaveLength(1);
    expect(emails).toHaveLength(1);
    expect(whats).toHaveLength(1);
    expect(repo.hasAlertBeenSent('cheap', ALERT_TYPE_BELOW_MARKET)).toBe(true);

    // Second pass: already alerted -> nothing fires.
    const again = await notifyBelowMarket({ repo, config: cfg, listings: [cheap], email, whatsapp });
    expect(again).toHaveLength(0);
    expect(emails).toHaveLength(1);
  });

  it('ignores listings that are not below market or lack a district', async () => {
    const repo = fakeRepo(20);
    const email = { send: async () => {} };
    const fired = await notifyBelowMarket({
      repo,
      config: cfg,
      listings: [listing({ id: 'ok', price_per_m2: 19 }), listing({ id: 'nodist', district: null, price_per_m2: 1 })],
      email,
      whatsapp: null,
    });
    expect(fired).toHaveLength(0);
  });

  it('still records the alert when only one channel succeeds', async () => {
    const repo = fakeRepo(20);
    const warns: string[] = [];
    const email = { send: async () => { throw new Error('smtp down'); } };
    const whatsapp = {
      send: async () => {},
      close: async () => {},
      enabled: true,
    };
    const fired = await notifyBelowMarket({
      repo,
      config: cfg,
      listings: [listing({ id: 'cheap', price_per_m2: 10 })],
      email,
      whatsapp,
      logger: { warn: (m: unknown) => warns.push(String(m)) },
    });
    expect(fired).toHaveLength(1);
    expect(warns.some((w) => w.includes('email alert failed'))).toBe(true);
  });

  it('does not record when all channels fail', async () => {
    const repo = fakeRepo(20);
    const email = { send: async () => { throw new Error('smtp down'); } };
    const whatsapp = {
      send: async () => { throw new Error('wa down'); },
      close: async () => {},
      enabled: true,
    };
    const fired = await notifyBelowMarket({
      repo,
      config: cfg,
      listings: [listing({ id: 'cheap', price_per_m2: 10 })],
      email,
      whatsapp,
      logger: { warn() {} },
    });
    expect(fired).toHaveLength(0);
    expect(repo.hasAlertBeenSent('cheap', ALERT_TYPE_BELOW_MARKET)).toBe(false);
  });
});
