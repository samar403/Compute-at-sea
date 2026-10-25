# Architecture

```
┌──────────────────────────── browser ────────────────────────────┐
│ React 19 + Vite · react-router · hand-built SVG/Canvas          │
│  Descent  Bridge  Berth  Router  Charter  Ledger  ⌘K  Officer   │
│        │ EventSource /api/stream      │ fetch /api/*            │
└────────┼──────────────────────────────┼─────────────────────────┘
         │                              │
┌────────▼──────────────────────────────▼─────────────────────────┐
│ Express 5 (Node 22)                                             │
│  FleetSimulator ── ticks every 2 s, sim clock ×SIM_SPEED        │
│  BridgeOfficer ─── Claude tool runner (or rules fallback)       │
│  Store ─────────── node:sqlite: charters · jobs · waitlist      │
│  landmask ──────── Natural Earth 1:50m land + coast vertices    │
└────────┬────────────────────────────────────────────────────────┘
         │ imports
┌────────▼────────────────────────────────────────────────────────┐
│ src/shared: pure, deterministic, used by server AND browser      │
│  ocean.ts      metocean climatology, Pierson–Moskowitz waves     │
│  vessel.ts     position, motion envelope, dispatch, heat balance │
│  berth.ts      six-factor site scoring                           │
│  scheduler.ts  Tide Router (priority → EDF, per-hour capacity)   │
│  economics.ts  charter quotes + land-vs-sea cash model (zod)     │
│  geo.ts        great circles, fibre RTT, UNCLOS zones, metros    │
└─────────────────────────────────────────────────────────────────┘
```

## Why the shared core matters

The same TypeScript runs on the server and in the browser:

- The **Charter desk** prices instantly in the browser using `quote()`. The server re-validates with the same zod schema and recomputes the quote before storing a reservation, so the client can never set its own price.
- The **Ledger** runs `tco()` on every slider move with no round-trip.
- The **Bridge** computes spot capacity from forecasts with `spotGpus()` exactly as the router does.

## The simulation

| Model | Implementation |
|---|---|
| Wind | Latitude bands (doldrums, trades, westerlies, Southern Ocean) × season × seeded synoptic noise (3–4 day systems) + rare deep lows |
| Waves | Wind sea from Pierson–Moskowitz (`Hs = 0.21 U²/g`) combined with persistent swell |
| Sea temperature | Latitude curve + seasonal amplitude; intake at 30 m sits below the summer mixed layer |
| Turbines | 150 m hub via a power-law shear, cut-in 3.5, rated 12.5, cut-out 27 m/s |
| Motion envelope | 100 % load ≤ Hs 5.5 m, linear to 60 % at 9 m, storm mode 35 % above |
| Dispatch | Wind → battery (smoothing band ≥50 %) → shore cable → battery (reserve band ≥30 %) → methanol gensets → shed IT |
| Cooling | Cooling fraction rises with intake temperature; hotel and DP load rise with Hs; PUE = facility / IT |
| Thermal outfall | Loop sized for 8 K at design heat, VFD pumps ≥40 % flow, diffuser dilution grows with sea state |
| Latency | Great-circle km × 1.35 route factor at 200 km/ms, both ways, + 0.6 ms equipment |

Everything is seeded by location and time. Two users, the server, the router and the tests all see the same weather.

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Liveness, sim time, AI mode |
| GET | `/api/catalog` | GPU models, vessel classes, metros |
| GET | `/api/fleet` | Specs + current snapshot |
| GET | `/api/fleet/:id` | Spec, telemetry, 8 h history |
| GET | `/api/fleet/:id/forecast?hours=` | Hourly outlook (1–168 h) |
| GET | `/api/stream` | **SSE** fleet snapshot every tick |
| GET | `/api/berth/score?lat=&lon=` | Six-factor berth score |
| GET | `/api/berth/search?metro=` | Ring survey around a metro, best 6 |
| POST | `/api/quote` | Charter quote |
| GET/POST | `/api/charters` | List / reserve |
| DELETE | `/api/charters/:id` | Release |
| GET/POST | `/api/jobs` | Manifest / file a job |
| DELETE | `/api/jobs/:id` | Remove a job |
| POST | `/api/jobs/reset` | Restore sample jobs |
| GET | `/api/plan?hours=` | Run the Tide Router |
| POST | `/api/tco` | Land-vs-sea model |
| POST | `/api/waitlist` | Join the charter queue (idempotent per email) |
| GET | `/api/ask/status` · POST `/api/ask` | Bridge Officer (rate-limited 20/min/IP) |

All inputs are validated with zod. Errors come back as `{ error, details[] }` with the right status code.

## Bridge Officer (Claude)

`src/server/bridge.ts` uses the Anthropic TypeScript SDK's **tool runner** (`client.beta.messages.toolRunner`) with five read-only `betaZodTool`s: `get_fleet_status`, `get_vessel`, `score_berth`, `nearest_vessels_to_metro` and `quote_charter`.

- The model defaults to `claude-opus-5-5`; override it with `BRIDGE_MODEL`.
- Effort is set to `low`, which suits a chat surface.
- Server-side refusal fallbacks are on (`fallbacks: "default"`), and a `refusal` stop reason is handled explicitly.
- If there is no `ANTHROPIC_API_KEY`, or the API errors, a deterministic intent matcher answers from the same tools. The UI says which mode answered and which tools it read.

## Design system

- **Three bridge palettes** as CSS tokens. *Day* is a paper nautical chart. *Dusk* is bridge glass. *Night* is ECDIS red: the whole UI turns monochrome red, as on real ships, to protect night vision.
- **Signal-flag navigation:** each section flies an ICS flag whose meaning fits it. *Alfa* means "diver down" (the descent). *Hotel* means "pilot on board" (the bridge). *Papa* means "about to proceed to sea" (siting). *Kilo* means "I wish to communicate with you" (the assistant).
- **Chart map:** Mercator like a real chart, buff land, shallow-water bands, and a neatline frame with alternating lat/lon scale bars. It supports wheel, pinch and keyboard zoom.
- **Descent:** the landing page is a dive. A depth gauge tracks scroll from 0 to −80 m while the water darkens from surface to abyss.
- **Typography:** Fraunces for display, Instrument Sans for UI, IBM Plex Mono for instruments.
- **Accessibility:** respects `prefers-reduced-motion`, keyboard-operable maps and hotspots, ARIA labels on every chart, and a skip link.
