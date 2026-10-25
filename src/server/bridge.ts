/**
 * The Bridge Officer: a natural-language ops assistant for the fleet.
 *
 * With ANTHROPIC_API_KEY set it runs Claude with five read-only tools over the
 * live simulation. Without a key it falls back to a deterministic intent
 * matcher that answers from the same data, so the feature always works.
 */
import Anthropic from '@anthropic-ai/sdk';
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { scoreBerth, type BerthScore } from '../shared/berth.js';
import { quote, type QuoteInput } from '../shared/economics.js';
import { FLEET, GPU_MODELS, vesselById } from '../shared/fleet.js';
import { formatLatLon, metroByName, METROS, rttMs } from '../shared/geo.js';
import { BEAUFORT_LABEL } from '../shared/ocean.js';
import type { Telemetry } from '../shared/types.js';
import { forecastVessel } from '../shared/vessel.js';
import { distanceToCoastKm, isLand } from './landmask.js';
import type { FleetSimulator } from './simulator.js';

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface BridgeReply {
  answer: string;
  mode: 'claude' | 'rules';
  toolCalls: Array<{ name: string; input: unknown }>;
  model?: string;
}

const SYSTEM_PROMPT = `You are the Bridge Officer of Compute at Sea, a fleet of offshore floating data-centre vessels that run AI workloads on seawater cooling and offshore wind.

You answer operators and customers on the fleet console. Ground every number in a tool result; the fleet is simulated live, so never invent telemetry. Use the tools before answering questions about vessels, weather, carbon, latency, siting or pricing.

Style: a calm, precise ship's officer. Lead with the answer in one sentence, then up to five short bullet points with the figures that matter (units always). Use plain markdown: **bold** and "- " bullets only, no headings or tables. If a question is outside fleet operations, say briefly what you can help with.`;

function round(n: number, d = 1): number {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

function vesselLine(tm: Telemetry) {
  const v = vesselById(tm.vesselId)!;
  return {
    id: v.id,
    name: v.name,
    class: v.cls,
    status: tm.status,
    position: formatLatLon(tm.position),
    berth: v.berthName,
    serves: v.servesMetro,
    itLoadMW: round(tm.itLoadMW),
    capacityMW: v.itCapacityMW,
    pue: round(tm.pue, 3),
    carbon_gCO2_per_kWh: Math.round(tm.carbonIntensity),
    hs_m: round(tm.sea.hs),
    wind_ms: round(tm.sea.wind),
    beaufort: `${tm.sea.beaufort} (${BEAUFORT_LABEL[tm.sea.beaufort]})`,
    sst_C: round(tm.sea.sst),
    batteryPct: Math.round(tm.batterySoc * 100),
    activeGpus: tm.activeGpus,
    gpuModel: GPU_MODELS[v.gpuModel].label,
    rttToServedMetro_ms: round(tm.rttMs, 2),
  };
}

export function createBridgeTools(sim: FleetSimulator) {
  const fleetStatus = () => {
    const s = sim.snapshot();
    return {
      simTime: new Date(s.t).toISOString(),
      totals: {
        itLoadMW: round(s.totals.itLoadMW),
        activeGpus: s.totals.activeGpus,
        avgPue: round(s.totals.avgPue, 3),
        avgCarbon_gCO2_per_kWh: Math.round(s.totals.avgCarbon),
        renewableSharePct: Math.round(s.totals.renewableShare * 100),
      },
      vessels: s.vessels.map(vesselLine),
      alerts: s.alerts
        .slice(0, 12)
        .map((a) => `${a.level.toUpperCase()} ${vesselById(a.vesselId)?.name}: ${a.message}`),
    };
  };

  const vesselDetail = (id: string) => {
    const spec = vesselById(id) ?? FLEET.find((v) => v.name.toLowerCase() === id.toLowerCase());
    if (!spec)
      return { error: `Unknown vessel "${id}". Known: ${FLEET.map((v) => v.id).join(', ')}` };
    const tm = sim.telemetry(spec.id)!;
    const fc = forecastVessel(spec, sim.simNow(), 48);
    const worst = fc.reduce((a, b) => (b.hs > a.hs ? b : a));
    return {
      ...vesselLine(tm),
      powerMixMW: Object.fromEntries(Object.entries(tm.mix).map(([k, v]) => [k, round(v)])),
      coolantSupply_C: round(tm.coolantSupplyC),
      gpuHotspot_C: round(tm.gpuHotspotC),
      outfallPlumeAt100m_K: round(tm.plumeDeltaK100m, 2),
      motion: {
        roll_deg: round(tm.rollDeg),
        pitch_deg: round(tm.pitchDeg),
        heave_m: round(tm.heaveM),
      },
      outlook48h: {
        peakHs_m: round(worst.hs),
        peakAt: new Date(worst.t).toISOString(),
        minMotionCapPct: Math.round(Math.min(...fc.map((f) => f.motionCap)) * 100),
        meanCarbon_gCO2_per_kWh: Math.round(
          fc.reduce((s, f) => s + f.carbonIntensity, 0) / fc.length,
        ),
      },
    };
  };

  const berth = (lat: number, lon: number): BerthScore => {
    const p = { lat, lon };
    const onLand = isLand(p);
    return scoreBerth(p, { onLand, coastKm: onLand ? 0 : distanceToCoastKm(p) });
  };

  const nearestToMetro = (metroName: string) => {
    const m = metroByName(metroName);
    if (!m)
      return {
        error: `Unknown metro "${metroName}". Try one of: ${METROS.map((x) => x.name).join(', ')}`,
      };
    return {
      metro: m.name,
      vessels: FLEET.map((v) => ({
        id: v.id,
        name: v.name,
        rtt_ms: round(rttMs(sim.telemetry(v.id)!.position, m), 2),
      }))
        .sort((a, b) => a.rtt_ms - b.rtt_ms)
        .slice(0, 4),
    };
  };

  return { fleetStatus, vesselDetail, berth, nearestToMetro, quote: (q: QuoteInput) => quote(q) };
}

type Tools = ReturnType<typeof createBridgeTools>;

function claudeTools(t: Tools, calls: BridgeReply['toolCalls']) {
  const log = <T>(name: string, input: unknown, out: T): string => {
    calls.push({ name, input });
    return JSON.stringify(out);
  };
  return [
    betaZodTool({
      name: 'get_fleet_status',
      description:
        'Live status of every vessel: load, PUE, carbon intensity, sea state, battery, alerts. Use for any fleet-wide or comparative question.',
      inputSchema: z.object({}),
      run: async (input) => log('get_fleet_status', input, t.fleetStatus()),
    }),
    betaZodTool({
      name: 'get_vessel',
      description:
        'Detailed telemetry and 48-hour weather/capacity outlook for one vessel, by id or name (e.g. "halcyon").',
      inputSchema: z.object({ vessel: z.string().describe('Vessel id or name') }),
      run: async (input) => log('get_vessel', input, t.vesselDetail(input.vessel)),
    }),
    betaZodTool({
      name: 'score_berth',
      description:
        'Score a candidate mooring site (0–100) on latency, wind, cooling, sea state, mooring distance and jurisdiction.',
      inputSchema: z.object({
        lat: z.number().min(-80).max(80),
        lon: z.number().min(-180).max(180),
      }),
      run: async (input) => {
        const b = t.berth(input.lat, input.lon);
        return log('score_berth', input, {
          ...b,
          climate:
            b.climate &&
            Object.fromEntries(Object.entries(b.climate).map(([k, v]) => [k, round(v, 2)])),
        });
      },
    }),
    betaZodTool({
      name: 'nearest_vessels_to_metro',
      description: 'Rank vessels by round-trip network latency to a coastal metro (e.g. "Tokyo").',
      inputSchema: z.object({ metro: z.string() }),
      run: async (input) => log('nearest_vessels_to_metro', input, t.nearestToMetro(input.metro)),
    }),
    betaZodTool({
      name: 'quote_charter',
      description:
        'Price a GPU charter. gpuModel: gb300 | b200 | mi355x | h200. termMonths: 1,3,6,12,24,36. sla: standard | pinned | sovereign.',
      inputSchema: z.object({
        gpuModel: z.enum(['gb300', 'b200', 'mi355x', 'h200']),
        gpuCount: z.number().int().min(8).max(20000),
        termMonths: z.union([
          z.literal(1),
          z.literal(3),
          z.literal(6),
          z.literal(12),
          z.literal(24),
          z.literal(36),
        ]),
        sla: z.enum(['standard', 'pinned', 'sovereign']).default('standard'),
      }),
      run: async (input) => {
        const q = t.quote({ ...input, burst: false });
        return log('quote_charter', input, {
          gpu: q.gpuLabel,
          ratePerGpuHour: round(q.ratePerGpuHour, 3),
          monthlyUSD: Math.round(q.monthly),
          totalUSD: Math.round(q.total),
          itMW: round(q.itMW, 2),
          savingsVsLandPct: round(q.savingsVsLandPct),
          carbonTPerMonth: Math.round(q.carbonTPerMonth),
          landCarbonTPerMonth: Math.round(q.landCarbonTPerMonth),
        });
      },
    }),
  ];
}

export async function askClaude(
  client: Anthropic,
  model: string,
  tools: Tools,
  history: ChatTurn[],
): Promise<BridgeReply> {
  const calls: BridgeReply['toolCalls'] = [];
  const message = await client.beta.messages.toolRunner({
    model,
    max_tokens: 16000,
    system: SYSTEM_PROMPT,
    output_config: { effort: 'low' },
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    tools: claudeTools(tools, calls),
    messages: history.map((h) => ({ role: h.role, content: h.content })),
    max_iterations: 8,
  });

  if (message.stop_reason === 'refusal') {
    return {
      answer:
        'I can’t help with that one. Ask me about the fleet, the weather at a berth, latency, carbon or a charter quote.',
      mode: 'claude',
      toolCalls: calls,
      model: message.model,
    };
  }
  const text = message.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
  return {
    answer: text || 'No answer was produced.',
    mode: 'claude',
    toolCalls: calls,
    model: message.model,
  };
}

// ── Deterministic fallback ──────────────────────────────────────────────────

const fmt = (n: number, d = 1) =>
  n.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });

export function askRules(tools: Tools, question: string): BridgeReply {
  const q = question.toLowerCase();
  const calls: BridgeReply['toolCalls'] = [];
  const status = () => {
    calls.push({ name: 'get_fleet_status', input: {} });
    return tools.fleetStatus();
  };

  // A specific vessel?
  const vessel = FLEET.find((v) => q.includes(v.id) || q.includes(v.name.toLowerCase()));
  if (vessel) {
    calls.push({ name: 'get_vessel', input: { vessel: vessel.id } });
    const d = tools.vesselDetail(vessel.id) as Exclude<
      ReturnType<Tools['vesselDetail']>,
      { error: string }
    >;
    return {
      mode: 'rules',
      toolCalls: calls,
      answer: [
        `**${d.name}** is ${d.status.replace('-', ' ')} at ${d.position}, carrying **${fmt(d.itLoadMW)} MW** of ${d.capacityMW} MW IT.`,
        `- PUE **${d.pue}** with seawater at ${fmt(d.sst_C)} °C; GPU hotspot ${fmt(d.gpuHotspot_C)} °C`,
        `- Sea: Hs ${fmt(d.hs_m)} m, wind ${fmt(d.wind_ms)} m/s — Beaufort ${d.beaufort}`,
        `- Carbon **${d.carbon_gCO2_per_kWh} gCO₂/kWh**, battery ${d.batteryPct} %`,
        `- 48 h outlook: peak Hs ${fmt(d.outlook48h.peakHs_m)} m, load floor ${d.outlook48h.minMotionCapPct} %`,
        `- ${fmt(d.rttToServedMetro_ms, 2)} ms RTT to ${d.serves}`,
      ].join('\n'),
    };
  }

  // Berth scoring: look for two numbers.
  const nums = question.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  if (/(berth|site|moor|score|deploy)/.test(q) && nums.length >= 2) {
    const [lat, lon] = nums;
    calls.push({ name: 'score_berth', input: { lat, lon } });
    const b = tools.berth(lat, lon);
    if (b.onLand)
      return {
        mode: 'rules',
        toolCalls: calls,
        answer: `**${lat}, ${lon} is on land.** ${b.verdict}`,
      };
    return {
      mode: 'rules',
      toolCalls: calls,
      answer: [
        `**Grade ${b.grade} — ${fmt(b.total, 0)}/100.** ${b.verdict}`,
        ...b.factors.map((f) => `- ${f.label}: ${fmt(f.score, 0)} — ${f.detail}`),
      ].join('\n'),
    };
  }

  // Quotes.
  if (/(quote|price|cost|charter|rent|how much)/.test(q)) {
    const count = nums.find((n) => n >= 8) ?? 1024;
    const model =
      (Object.keys(GPU_MODELS) as Array<keyof typeof GPU_MODELS>).find((k) => q.includes(k)) ??
      'gb300';
    const term =
      ([36, 24, 12, 6, 3, 1] as const).find(
        (t) => q.includes(`${t} month`) || q.includes(`${t}-month`),
      ) ?? 12;
    const input: QuoteInput = {
      gpuModel: model,
      gpuCount: Math.min(20000, Math.round(count)),
      termMonths: term,
      sla: q.includes('sovereign') ? 'sovereign' : 'standard',
      burst: false,
    };
    calls.push({ name: 'quote_charter', input });
    const r = tools.quote(input);
    return {
      mode: 'rules',
      toolCalls: calls,
      answer: [
        `**${input.gpuCount.toLocaleString()} × ${r.gpuLabel} for ${term} months: $${fmt(r.ratePerGpuHour, 2)}/GPU-hour.**`,
        `- $${fmt(r.monthly / 1e6, 2)} M per month, $${fmt(r.total / 1e6, 1)} M over the term (${fmt(r.discountPct, 0)} % term discount)`,
        `- ${fmt(r.itMW, 2)} MW of IT; ${fmt(r.savingsVsLandPct, 0)} % below an equivalent land neocloud`,
        `- ${fmt(r.carbonTPerMonth, 0)} tCO₂/month vs ${fmt(r.landCarbonTPerMonth, 0)} t on land; ${fmt(r.freshwaterSavedM3PerMonth, 0)} m³ freshwater saved`,
      ].join('\n'),
    };
  }

  // Latency to a metro.
  const metro = METROS.find((m) => q.includes(m.name.toLowerCase()));
  if (metro) {
    calls.push({ name: 'nearest_vessels_to_metro', input: { metro: metro.name } });
    const r = tools.nearestToMetro(metro.name) as {
      metro: string;
      vessels: Array<{ name: string; rtt_ms: number }>;
    };
    return {
      mode: 'rules',
      toolCalls: calls,
      answer: [
        `**Closest to ${metro.name}: ${r.vessels[0].name} at ${fmt(r.vessels[0].rtt_ms, 2)} ms RTT.**`,
        ...r.vessels.slice(1).map((v) => `- ${v.name}: ${fmt(v.rtt_ms, 2)} ms`),
      ].join('\n'),
    };
  }

  const s = status();
  if (/(storm|weather|wave|sea|wind|rough)/.test(q)) {
    const sorted = [...s.vessels].sort((a, b) => b.hs_m - a.hs_m);
    return {
      mode: 'rules',
      toolCalls: calls,
      answer: [
        `**Roughest water: ${sorted[0].name}, Hs ${fmt(sorted[0].hs_m)} m (Beaufort ${sorted[0].beaufort}).**`,
        ...sorted
          .slice(0, 5)
          .map((v) => `- ${v.name}: Hs ${fmt(v.hs_m)} m, wind ${fmt(v.wind_ms)} m/s, ${v.status}`),
      ].join('\n'),
    };
  }
  if (/(carbon|green|clean|co2|emission|renewable)/.test(q)) {
    const sorted = [...s.vessels].sort((a, b) => a.carbon_gCO2_per_kWh - b.carbon_gCO2_per_kWh);
    return {
      mode: 'rules',
      toolCalls: calls,
      answer: [
        `**Cleanest right now: ${sorted[0].name} at ${sorted[0].carbon_gCO2_per_kWh} gCO₂/kWh.** Fleet average ${s.totals.avgCarbon_gCO2_per_kWh} g, ${s.totals.renewableSharePct} % renewable.`,
        ...sorted.map((v) => `- ${v.name}: ${v.carbon_gCO2_per_kWh} g/kWh`),
      ].join('\n'),
    };
  }
  if (/(pue|cool|efficien|temperature|heat)/.test(q)) {
    const sorted = [...s.vessels].sort((a, b) => a.pue - b.pue);
    return {
      mode: 'rules',
      toolCalls: calls,
      answer: [
        `**Best PUE: ${sorted[0].name} at ${sorted[0].pue}** — seawater at ${fmt(sorted[0].sst_C)} °C. Fleet average ${s.totals.avgPue}.`,
        ...sorted.map((v) => `- ${v.name}: PUE ${v.pue} (SST ${fmt(v.sst_C)} °C)`),
      ].join('\n'),
    };
  }
  if (/(alert|problem|issue|warning|wrong)/.test(q)) {
    return {
      mode: 'rules',
      toolCalls: calls,
      answer: s.alerts.length
        ? [`**${s.alerts.length} active notices.**`, ...s.alerts.map((a) => `- ${a}`)].join('\n')
        : '**All vessels nominal.** No active notices.',
    };
  }
  return {
    mode: 'rules',
    toolCalls: calls,
    answer: [
      `**Fleet: ${s.vessels.length} vessels carrying ${fmt(s.totals.itLoadMW)} MW across ${s.totals.activeGpus.toLocaleString()} GPUs.** PUE ${s.totals.avgPue}, ${s.totals.avgCarbon_gCO2_per_kWh} gCO₂/kWh, ${s.totals.renewableSharePct} % renewable.`,
      `- Ask about a vessel: “How is Halcyon doing?”`,
      `- Weather: “Which vessel is in the roughest sea?”`,
      `- Siting: “Score a berth at 36.5, -9.9”`,
      `- Pricing: “Quote 2048 b200 for 24 months”`,
      `- Latency: “What’s closest to Tokyo?”`,
    ].join('\n'),
  };
}

export class BridgeOfficer {
  private client: Anthropic | null;
  readonly model: string;
  private tools: Tools;

  constructor(sim: FleetSimulator, opts: { apiKey?: string; model?: string } = {}) {
    this.client = opts.apiKey ? new Anthropic({ apiKey: opts.apiKey }) : null;
    this.model = opts.model || 'claude-opus-5-5';
    this.tools = createBridgeTools(sim);
  }

  get aiEnabled(): boolean {
    return this.client !== null;
  }

  async ask(history: ChatTurn[]): Promise<BridgeReply> {
    const last = history[history.length - 1]?.content ?? '';
    if (!this.client) return askRules(this.tools, last);
    try {
      return await askClaude(this.client, this.model, this.tools, history);
    } catch (err) {
      // Degrade gracefully: the console should never go dark because the API did.
      const reason =
        err instanceof Anthropic.RateLimitError
          ? 'rate-limited'
          : err instanceof Anthropic.AuthenticationError
            ? 'API key rejected'
            : err instanceof Anthropic.APIConnectionError
              ? 'no connection'
              : err instanceof Anthropic.APIError
                ? `API error ${err.status ?? ''}`.trim()
                : 'unexpected error';
      console.warn(
        `[bridge] Claude unavailable (${reason}); answering from rules.`,
        err instanceof Error ? err.message : err,
      );
      const r = askRules(this.tools, last);
      return {
        ...r,
        answer: `${r.answer}\n\n_(AI officer unavailable: ${reason}. Answered from fleet rules.)_`,
      };
    }
  }
}
