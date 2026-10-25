# Compute at Sea — the pitch

> **The grid is full. The ocean isn't.**
> We moor AI data centres on ships, cooled by the sea and powered by the wind over it. They're energised in about 14 months, where a land site waits years for a grid connection.

This memo is the brief the product was built from. Every claim here maps to something you can poke at in the app: the live **Bridge**, the **Berth** planner, the **Tide Router**, the **Charter** desk and the **Ledger**.

---

## 1. The problem: AI is power-bound, not chip-bound

- **Interconnection queues.** In constrained markets a large new load waits roughly 3–7 years to connect to the grid, so training clusters are planned around where megawatts can be energised.
- **Water.** Evaporatively cooled land data centres use on the order of 1–2 litres of freshwater per kWh, often in regions that already ration water.
- **Heat density.** A modern liquid-cooled AI rack draws about 120–140 kW. That heat has to go somewhere cheap, quickly.

*(These figures are indicative ranges from public industry reporting. They vary by market.)*

## 2. The insight: move the computer, not the electrons

The ocean offers three things land campuses fight over:

| Constraint | Land campus | Compute at Sea |
|---|---|---|
| Cooling | Chillers / evaporative towers, PUE ~1.3–1.4 | Seawater drawn from 30 m through titanium exchangers, PUE ~1.03–1.09, zero freshwater evaporated |
| Power | Grid interconnect queue | Offshore wind tie-in at the berth, plus battery, shore cable and green-methanol backup |
| Time to power | ~3–5+ years | ~14 months: yard conversion, tow, hook-up |
| Mobility | Fixed | Relocatable: follow demand, sovereignty or cheap wind |

## 3. Product

**The vessels**
- **Leviathan:** a converted VLCC hull with a turret mooring, carrying 30–40 MW of IT.
- **Tidewater:** a purpose-built semi-submersible with low heave, carrying 20–24 MW.
- **Petrel:** a self-propelled relocatable unit on DP2, carrying 10–12 MW.

**The software** (this repository) is how customers and operators touch the fleet:
1. **Bridge:** live fleet console with power mix, PUE, sea state, motion, a 72 h outlook and a ship's log.
2. **Berth planner:** scores any patch of ocean on latency, wind, cooling, sea state, mooring and jurisdiction.
3. **Tide Router:** places batch AI jobs on the spot pool under latency, carbon and deadline constraints.
4. **Charter desk:** quotes and reserves GPU capacity with term, tier and berth preference.
5. **Ledger:** a land-vs-sea capital model where every assumption is a slider.
6. **Bridge Officer:** a Claude-powered ops assistant that answers from live telemetry through tools.

## 4. Business model

| Line | What the customer buys | Pricing shape |
|---|---|---|
| Reserved charters | 1–36 month GPU capacity | $/GPU-hour, term discounts up to 32 % |
| Tide spot pool | Preemptible batch capacity that follows the wind | Spot $/GPU-hour |
| Sovereign berths | Capacity inside one nation's EEZ, with flag, crew and audit to match | ×1.22 tier |
| Surplus energy | Wind beyond the racks' needs is exported ashore | Power purchase / merchant |

**Unit economics (default Ledger assumptions, 40 MW):** sea capex $9.8 M/MW against $11.5 M/MW on land, and 14 months to power against 44. With an 18 % O&M premium at sea, the sea case pays back around **month 28** versus **month 61** on land. The 30 months of extra operation are worth roughly **490 M GPU-hours**. The model shows where the edge comes from: shrink the land queue to 14 months and the sea's advantage disappears. **Time-to-power is the moat.**

## 5. Why now

1. Power became the binding constraint on AI build-outs.
2. Racks went liquid. Once the heat is in water, the sea is the best heat sink available.
3. Offshore wind needs early, flexible buyers to cope with curtailment and grid delays.
4. Ageing tankers and conversion-fluent yards exist. FPSO conversions have been routine in oil for decades.

## 6. Risks and how the product answers them

| Risk | Mitigation (modelled in the simulation) |
|---|---|
| Storms | A motion envelope caps load from Hs 5.5 m; storm mode at 9 m keeps 35 %; spot work fails over to sister vessels |
| Power gaps | Merit-order dispatch: wind → battery (≥50 %) → cable → battery reserve (≥30 %) → gensets → shed |
| Marine ecology | Outfall plume kept within +1 K at 100 m and alarmed in the ship's log; fish-safe intake velocity |
| Salt and corrosion | Sealed, dried, positive-pressure halls; closed coolant loop; cathodic protection |
| Jurisdiction | EEZ berths under coastal-state licence; the berth scorer penalises the high seas |
| Latency | Berths 20–80 km out: 1–4 ms RTT to the metro, shown live per vessel |

## 7. Go-to-market

1. **Beachhead:** frontier-model labs and neoclouds blocked by interconnection queues in the US Northeast, Northern Europe and Japan, where offshore wind exists today.
2. **Expansion:** sovereign AI programmes that want capacity inside their EEZ without new land permitting.
3. **Platform:** the Tide Router becomes the scheduler that moves preemptible work to wherever the wind is blowing.

## 8. What's in the demo fleet

Nine reference vessels off Amsterdam, New York, San Francisco, Mumbai, Singapore, Tokyo, Sydney and Oslo, plus *Wayfarer*, which relocates between Lisbon and Lagos. Together they carry about 220 MW of IT and about 123,000 GPUs. All telemetry is a deterministic physics simulation (see [ARCHITECTURE.md](ARCHITECTURE.md)), not live data.
