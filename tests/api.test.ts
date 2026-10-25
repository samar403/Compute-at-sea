import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/server/app';

let server: Server;
let base: string;
let ctx: ReturnType<typeof createApp>;

const get = async (path: string) => {
  const r = await fetch(`${base}${path}`);
  return { status: r.status, body: r.status === 204 ? null : await r.json() };
};
const send = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: r.status === 204 ? null : await r.json() };
};

beforeAll(async () => {
  ctx = createApp({ dbPath: ':memory:', startTicker: false });
  server = ctx.app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(() => {
  server.close();
  ctx.store.close();
});

describe('API', () => {
  it('reports health', async () => {
    const r = await get('/health');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, vessels: 9, ai: false });
  });

  it('serves the fleet snapshot and a single vessel', async () => {
    const fleet = await get('/fleet');
    expect(fleet.body.specs).toHaveLength(9);
    expect(fleet.body.snapshot.vessels).toHaveLength(9);
    expect(fleet.body.snapshot.totals.itLoadMW).toBeGreaterThan(0);

    const v = await get('/fleet/halcyon');
    expect(v.body.spec.name).toBe('Halcyon');
    expect(v.body.history.length).toBeGreaterThan(100);

    expect((await get('/fleet/nope')).status).toBe(404);
  });

  it('forecasts with bounded horizons', async () => {
    const r = await get('/fleet/kestrel/forecast?hours=24');
    expect(r.body.hours).toHaveLength(24);
    expect((await get('/fleet/kestrel/forecast?hours=999')).status).toBe(400);
  });

  it('scores berths on water and refuses land', async () => {
    const sea = await get('/berth/score?lat=53.85&lon=3.3');
    expect(sea.body.onLand).toBe(false);
    expect(sea.body.total).toBeGreaterThan(40);
    const land = await get('/berth/score?lat=48.85&lon=2.35');
    expect(land.body.onLand).toBe(true);
    expect((await get('/berth/score?lat=abc&lon=1')).status).toBe(400);
  });

  it('surveys the best berths near a metro', async () => {
    const r = await get('/berth/search?metro=Tokyo');
    expect(r.status).toBe(200);
    expect(r.body.best.length).toBeGreaterThan(0);
    expect(r.body.best[0].total).toBeGreaterThanOrEqual(r.body.best[r.body.best.length - 1].total);
    expect((await get('/berth/search?metro=Atlantis')).status).toBe(404);
  });

  it('quotes and validates', async () => {
    const ok = await send('POST', '/quote', {
      gpuModel: 'b200',
      gpuCount: 512,
      termMonths: 12,
      sla: 'pinned',
      burst: false,
    });
    expect(ok.status).toBe(200);
    expect(ok.body.ratePerGpuHour).toBeGreaterThan(0);
    const bad = await send('POST', '/quote', {
      gpuModel: 'tpu',
      gpuCount: 2,
      termMonths: 7,
      sla: 'x',
    });
    expect(bad.status).toBe(400);
    expect(bad.body.details.length).toBeGreaterThanOrEqual(3);
  });

  it('rejects malformed JSON cleanly', async () => {
    const r = await fetch(`${base}/quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{nope',
    });
    expect(r.status).toBe(400);
  });

  it('reserves, lists and releases charters', async () => {
    const created = await send('POST', '/charters', {
      company: 'Abyssal Labs',
      contactEmail: 'ops@abyssal.example',
      vesselId: 'halcyon',
      quote: { gpuModel: 'gb300', gpuCount: 1024, termMonths: 12, sla: 'standard', burst: false },
    });
    expect(created.status).toBe(201);
    expect(created.body.ref).toMatch(/^CP-\d{4}-[0-9A-F]{4}$/);
    expect(created.body.quote.total).toBeGreaterThan(0);

    const list = await get('/charters');
    expect(list.body.some((c: { id: string }) => c.id === created.body.id)).toBe(true);

    expect((await send('DELETE', `/charters/${created.body.id}`)).status).toBe(204);
    expect((await send('DELETE', `/charters/${created.body.id}`)).status).toBe(404);

    const bad = await send('POST', '/charters', {
      company: 'X',
      contactEmail: 'not-an-email',
      quote: {},
    });
    expect(bad.status).toBe(400);
  });

  it('seeds, adds, plans and removes jobs', async () => {
    const seeded = await get('/jobs');
    expect(seeded.body.length).toBeGreaterThan(0);

    const job = await send('POST', '/jobs', {
      name: 'test-run',
      gpuHours: 5000,
      maxGpus: 256,
      deadlineHours: 48,
      priority: 3,
      latencyMetro: 'New York',
      maxRttMs: 5,
      carbonCapG: null,
    });
    expect(job.status).toBe(201);

    const plan = await get('/plan?hours=48');
    expect(plan.body.plan.hours).toBe(48);
    const placed = plan.body.plan.placements.find(
      (p: { jobId: string }) => p.jobId === job.body.id,
    );
    expect(placed).toBeTruthy();
    expect(placed.vesselId).toBe('meridian');

    expect(
      (
        await send('POST', '/jobs', {
          name: 'x',
          gpuHours: 1,
          maxGpus: 1,
          deadlineHours: 1,
          priority: 1,
          latencyMetro: 'Atlantis',
        })
      ).status,
    ).toBe(400);
    expect((await send('DELETE', `/jobs/${job.body.id}`)).status).toBe(204);
    const reset = await send('POST', '/jobs/reset');
    expect(reset.body.length).toBe(seeded.body.length);
  });

  it('keeps one waitlist place per email', async () => {
    const a = await send('POST', '/waitlist', {
      email: 'Captain@Example.com',
      company: 'Nautilus',
      mw: 20,
      useCase: 'training',
    });
    expect(a.status).toBe(201);
    const b = await send('POST', '/waitlist', {
      email: 'captain@example.com',
      company: 'Nautilus',
      mw: 20,
      useCase: 'training',
    });
    expect(b.status).toBe(200);
    expect(b.body.duplicate).toBe(true);
    expect(b.body.position).toBe(a.body.position);
    expect((await get('/waitlist/stats')).body.count).toBe(1);
  });

  it('answers the bridge officer in rules mode', async () => {
    const status = await get('/ask/status');
    expect(status.body.ai).toBe(false);
    const vessel = await send('POST', '/ask', {
      messages: [{ role: 'user', content: 'How is Halcyon doing?' }],
    });
    expect(vessel.body.mode).toBe('rules');
    expect(vessel.body.answer).toMatch(/Halcyon/);
    expect(vessel.body.toolCalls[0].name).toBe('get_vessel');
    const quote = await send('POST', '/ask', {
      messages: [{ role: 'user', content: 'Quote 2048 b200 for 24 months' }],
    });
    expect(quote.body.answer).toMatch(/2,048 × B200/);
    const berth = await send('POST', '/ask', {
      messages: [{ role: 'user', content: 'Score a berth at 36.5, -9.9' }],
    });
    expect(berth.body.answer).toMatch(/Grade/);
    const bad = await send('POST', '/ask', { messages: [{ role: 'assistant', content: 'hi' }] });
    expect(bad.status).toBe(400);
  });

  it('returns JSON 404s for unknown API routes', async () => {
    const r = await get('/does-not-exist');
    expect(r.status).toBe(404);
    expect(r.body.error).toBe('Not found');
  });
});
