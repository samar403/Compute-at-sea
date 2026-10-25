import express, { type NextFunction, type Request, type Response } from 'express';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { scoreBerth } from '../shared/berth.js';
import { quote, QuoteInput, tco, TCO_DEFAULTS, TcoInput } from '../shared/economics.js';
import { FLEET, GPU_MODELS, VESSEL_CLASSES, vesselById } from '../shared/fleet.js';
import { destinationPoint, metroByName, METROS } from '../shared/geo.js';
import { HOUR_MS } from '../shared/math.js';
import { JobInput, planWorkloads, SAMPLE_JOBS } from '../shared/scheduler.js';
import type { ForecastHour } from '../shared/types.js';
import { forecastVessel } from '../shared/vessel.js';
import { BridgeOfficer, type ChatTurn } from './bridge.js';
import { Store } from './db.js';
import { distanceToCoastKm, isLand } from './landmask.js';
import { FleetSimulator } from './simulator.js';

export interface AppOptions {
  dbPath: string;
  simSpeed?: number;
  tickMs?: number;
  startTicker?: boolean;
  anthropicApiKey?: string;
  bridgeModel?: string;
  staticDir?: string;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

const parse = <T extends z.ZodType>(schema: T, data: unknown): z.infer<T> => {
  const r = schema.safeParse(data);
  if (!r.success) {
    throw new HttpError(
      400,
      'Invalid request',
      r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  return r.data;
};

/** Tiny fixed-window limiter, per client IP. Enough to keep the AI endpoint honest. */
function rateLimit(limit: number, windowMs: number) {
  const hits = new Map<string, { n: number; reset: number }>();
  return (req: Request, res: Response, next: NextFunction) => {
    const key = req.ip ?? 'unknown';
    const now = Date.now();
    const h = hits.get(key);
    if (!h || h.reset < now) {
      hits.set(key, { n: 1, reset: now + windowMs });
      return next();
    }
    if (++h.n > limit) {
      res.setHeader('Retry-After', Math.ceil((h.reset - now) / 1000));
      return next(new HttpError(429, 'Too many requests — the bridge needs a moment.'));
    }
    next();
  };
}

const CharterInput = z.object({
  company: z.string().trim().min(2).max(120),
  contactEmail: z.string().trim().email().max(200),
  vesselId: z.string().nullable().default(null),
  quote: QuoteInput,
});

const WaitlistInput = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  company: z.string().trim().min(1).max(120),
  mw: z.number().min(0.1).max(1000),
  useCase: z.string().trim().max(60).default('training'),
});

const AskInput = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().trim().min(1).max(2000),
      }),
    )
    .min(1)
    .max(20)
    .refine((m) => m[m.length - 1].role === 'user', 'Last message must be from the user'),
});

const LatLonQuery = z.object({
  lat: z.coerce.number().min(-85).max(85),
  lon: z.coerce.number().min(-180).max(180),
});

export function createApp(opts: AppOptions) {
  const store = new Store(opts.dbPath);
  const sim = new FleetSimulator({ simSpeed: opts.simSpeed, tickMs: opts.tickMs });
  if (opts.startTicker !== false) sim.start();
  const bridge = new BridgeOfficer(sim, { apiKey: opts.anthropicApiKey, model: opts.bridgeModel });

  // Seed the router with sample jobs on first boot so the manifest is never empty.
  if (!store.getMeta('seeded')) {
    for (const j of SAMPLE_JOBS) store.createJob(j);
    store.setMeta('seeded', '1');
  }

  const forecastCache = new Map<string, { at: number; data: ForecastHour[] }>();
  const forecast = (id: string, hours: number): ForecastHour[] => {
    const spec = vesselById(id)!;
    const hourKey = Math.floor(sim.simNow() / HOUR_MS);
    const key = `${id}:${hours}`;
    const hit = forecastCache.get(key);
    if (hit && hit.at === hourKey) return hit.data;
    const data = forecastVessel(spec, sim.simNow(), hours);
    forecastCache.set(key, { at: hourKey, data });
    return data;
  };

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');
  app.use(express.json({ limit: '64kb' }));
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    next();
  });

  const api = express.Router();

  api.get('/health', (_req, res) => {
    res.json({
      ok: true,
      simTime: sim.simNow(),
      simSpeed: sim.simSpeed,
      vessels: FLEET.length,
      ai: bridge.aiEnabled,
    });
  });

  api.get('/catalog', (_req, res) => {
    res.json({ gpus: Object.values(GPU_MODELS), classes: VESSEL_CLASSES, metros: METROS });
  });

  api.get('/fleet', (_req, res) => {
    res.json({ specs: FLEET, snapshot: sim.snapshot() });
  });

  api.get('/fleet/:id', (req, res) => {
    const spec = vesselById(req.params.id);
    if (!spec) throw new HttpError(404, 'Vessel not found');
    res.json({
      spec,
      telemetry: sim.telemetry(spec.id),
      history: sim.history(spec.id),
      class: VESSEL_CLASSES[spec.cls],
    });
  });

  api.get('/fleet/:id/forecast', (req, res) => {
    const spec = vesselById(req.params.id);
    if (!spec) throw new HttpError(404, 'Vessel not found');
    const { hours } = parse(
      z.object({ hours: z.coerce.number().int().min(1).max(168).default(72) }),
      req.query,
    );
    res.json({ vesselId: spec.id, hours: forecast(spec.id, hours) });
  });

  /** Server-sent events: one fleet snapshot per simulation tick. */
  api.get('/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    const send = (data: unknown) => res.write(`event: snapshot\ndata: ${JSON.stringify(data)}\n\n`);
    send(sim.snapshot());
    const unsubscribe = sim.subscribe(send);
    const ping = setInterval(() => res.write(': keep-alive\n\n'), 15000);
    req.on('close', () => {
      clearInterval(ping);
      unsubscribe();
    });
  });

  api.get('/berth/score', (req, res) => {
    const { lat, lon } = parse(LatLonQuery, req.query);
    const p = { lat, lon };
    const onLand = isLand(p);
    res.json(scoreBerth(p, { onLand, coastKm: onLand ? 0 : distanceToCoastKm(p) }));
  });

  /** Survey rings around a metro and return the best-scoring berths. */
  api.get('/berth/search', (req, res) => {
    const { metro: name } = parse(z.object({ metro: z.string().min(1).max(60) }), req.query);
    const metro = metroByName(name);
    if (!metro) throw new HttpError(404, 'Unknown metro');
    const candidates = [];
    for (const km of [22, 40, 65, 100, 150]) {
      for (let b = 0; b < 360; b += 30) {
        const p = destinationPoint(metro, b + (km % 2 ? 15 : 0), km);
        if (isLand(p)) continue;
        candidates.push(scoreBerth(p, { onLand: false, coastKm: distanceToCoastKm(p) }));
      }
    }
    candidates.sort((a, b) => b.total - a.total);
    res.json({ metro, surveyed: candidates.length, best: candidates.slice(0, 6) });
  });

  api.post('/quote', (req, res) => {
    res.json(quote(parse(QuoteInput, req.body)));
  });

  api.get('/tco/defaults', (_req, res) => res.json(TCO_DEFAULTS));
  api.post('/tco', (req, res) => {
    res.json(tco(parse(TcoInput, { ...TCO_DEFAULTS, ...req.body })));
  });

  api.get('/charters', (_req, res) => res.json(store.listCharters()));
  api.post('/charters', (req, res) => {
    const input = parse(CharterInput, req.body);
    if (input.vesselId && !vesselById(input.vesselId)) throw new HttpError(400, 'Unknown vessel');
    const charter = store.createCharter({ ...input, quote: quote(input.quote) });
    res.status(201).json(charter);
  });
  api.delete('/charters/:id', (req, res) => {
    if (!store.cancelCharter(req.params.id))
      throw new HttpError(404, 'Charter not found or already cancelled');
    res.status(204).end();
  });

  api.get('/jobs', (_req, res) => res.json(store.listJobs()));
  api.post('/jobs', (req, res) => {
    const input = parse(JobInput, req.body);
    if (input.latencyMetro && !METROS.some((m) => m.name === input.latencyMetro))
      throw new HttpError(400, 'Unknown metro');
    res.status(201).json(store.createJob(input));
  });
  api.delete('/jobs/:id', (req, res) => {
    if (!store.deleteJob(req.params.id)) throw new HttpError(404, 'Job not found');
    res.status(204).end();
  });
  api.post('/jobs/reset', (_req, res) => {
    store.clearJobs();
    for (const j of SAMPLE_JOBS) store.createJob(j);
    res.json(store.listJobs());
  });

  api.get('/plan', (req, res) => {
    const { hours } = parse(
      z.object({ hours: z.coerce.number().int().min(12).max(168).default(96) }),
      req.query,
    );
    const forecasts = Object.fromEntries(FLEET.map((v) => [v.id, forecast(v.id, hours)]));
    const jobs = store.listJobs();
    res.json({ jobs, plan: planWorkloads(jobs, FLEET, forecasts, hours), forecasts });
  });

  api.post('/waitlist', (req, res) => {
    const input = parse(WaitlistInput, req.body);
    const r = store.addToWaitlist(input);
    res
      .status(r.duplicate ? 200 : 201)
      .json({ position: r.position, duplicate: r.duplicate, stats: store.waitlistStats() });
  });
  api.get('/waitlist/stats', (_req, res) => res.json(store.waitlistStats()));

  api.get('/ask/status', (_req, res) =>
    res.json({ ai: bridge.aiEnabled, model: bridge.aiEnabled ? bridge.model : null }),
  );
  api.post('/ask', rateLimit(20, 60_000), async (req, res, next) => {
    try {
      const { messages } = parse(AskInput, req.body);
      res.json(await bridge.ask(messages as ChatTurn[]));
    } catch (err) {
      next(err);
    }
  });

  api.use((_req, _res, next) => next(new HttpError(404, 'Not found')));

  app.use('/api', api);

  const staticDir = opts.staticDir;
  if (staticDir && existsSync(staticDir)) {
    app.use(express.static(staticDir, { index: false, maxAge: '1h' }));
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(resolve(staticDir, 'index.html')));
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message, details: err.details });
      return;
    }
    if (err && typeof err === 'object' && 'type' in err && err.type === 'entity.parse.failed') {
      res.status(400).json({ error: 'Malformed JSON body' });
      return;
    }
    console.error(err);
    res.status(500).json({ error: 'Internal error' });
  });

  return { app, sim, store, bridge };
}
