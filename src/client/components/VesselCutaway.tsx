import { useState } from 'react';

interface Part {
  id: string;
  n: number;
  title: string;
  spec: string;
  text: string;
  x: number;
  y: number;
}

const PARTS: Part[] = [
  {
    id: 'halls',
    n: 1,
    title: 'Compute halls',
    spec: '4 decks · 330 racks · 40 MW IT',
    text: 'Sealed, positive-pressure halls with dry nitrogen-enriched air: no salt ever reaches a board. Liquid-cooled racks sit on damped skids rated for 0.3 g, so motion is a load limit, not a failure mode.',
    x: 430,
    y: 112,
  },
  {
    id: 'intake',
    n: 2,
    title: 'Deep seawater intake',
    spec: '−30 m · 4–18 °C at temperate berths',
    text: 'Water is drawn from below the warm surface mixed layer through a low-velocity screen (under 0.15 m/s) so fish can swim away from it. No chillers, no cooling towers, no evaporation.',
    x: 330,
    y: 318,
  },
  {
    id: 'hx',
    n: 3,
    title: 'Titanium plate exchangers',
    spec: '3.5 K approach · closed coolant loop',
    text: 'Racks run on a closed freshwater–glycol loop. Titanium plates hand the heat to seawater, which never touches electronics. Pumps are variable-speed: cooling energy follows the load.',
    x: 470,
    y: 232,
  },
  {
    id: 'battery',
    n: 4,
    title: 'Battery room',
    spec: '80 MWh LFP · 30 % storm reserve',
    text: 'Smooths minute-to-minute wind and soaks up surplus. The bottom 30 % is never touched in normal operations — it is the ride-through that carries priority workloads through a squall.',
    x: 610,
    y: 232,
  },
  {
    id: 'genset',
    n: 5,
    title: 'Green-methanol gensets',
    spec: '20 MW · last resort',
    text: 'Dual-fuel engines on renewable methanol for long calms with the shore cable down. Lifecycle around 140 gCO₂e/kWh — far below a coal grid, and the dispatcher only reaches for them when wind, battery and cable are exhausted.',
    x: 760,
    y: 232,
  },
  {
    id: 'turret',
    n: 6,
    title: 'Turret mooring',
    spec: '9-line spread · weathervaning',
    text: 'The hull swings freely around a bow turret, always heading into the weather. That alone cuts roll dramatically — the single biggest reason a converted tanker makes a good server room.',
    x: 128,
    y: 180,
  },
  {
    id: 'cable',
    n: 7,
    title: 'Export cable & fibre',
    spec: '66 kV · dual diverse fibre · 20–80 km to shore',
    text: 'Power flows both ways through the turret swivel: import when the wind drops, export when it blows. Two fibre routes to separate landing stations keep metro latency at 1–4 ms round trip.',
    x: 150,
    y: 330,
  },
  {
    id: 'outfall',
    n: 8,
    title: 'Outfall diffuser',
    spec: '≤ +1 K at 100 m',
    text: 'Warm water leaves through a multiport diffuser that mixes it fast. The plume limit is a hard constraint in the dispatcher, monitored continuously and reported to the coastal regulator.',
    x: 880,
    y: 300,
  },
  {
    id: 'bridge',
    n: 9,
    title: 'Bridge, crew & helideck',
    spec: '22 crew · 28-day rotations',
    text: 'Mariners and data-centre technicians share the watch. Crew change by helicopter or supply vessel; spares ride the same boats. The bridge keeps a 500 m safety zone under radar and AIS watch.',
    x: 852,
    y: 60,
  },
];

/** Side elevation of a Leviathan-class vessel with explorable systems. */
export function VesselCutaway() {
  const [active, setActive] = useState<string>('halls');
  const part = PARTS.find((p) => p.id === active)!;

  return (
    <div className="cutaway">
      <svg
        viewBox="0 0 1000 360"
        className="cutaway-svg"
        role="group"
        aria-label="Cutaway of a Leviathan-class compute vessel"
      >
        {/* Sea */}
        <rect x="0" y="196" width="1000" height="164" fill="var(--sea-2)" opacity="0.6" />
        <path
          d="M0 196 Q 25 190 50 196 T 100 196 T 150 196 T 200 196 T 250 196 T 300 196 T 350 196 T 400 196 T 450 196 T 500 196 T 550 196 T 600 196 T 650 196 T 700 196 T 750 196 T 800 196 T 850 196 T 900 196 T 950 196 T 1000 196"
          fill="none"
          stroke="var(--ink)"
          strokeWidth="1"
          className="cutaway-wave"
        />
        <text x="990" y="190" textAnchor="end" className="cutaway-note">
          WL 0 m
        </text>
        <line x1="0" x2="1000" y1="330" y2="330" stroke="var(--ink-3)" strokeDasharray="2 6" />
        <text x="990" y="324" textAnchor="end" className="cutaway-note">
          −30 m intake depth
        </text>

        {/* Hull */}
        <path
          d="M70 150 H930 L950 170 L940 222 H120 Q70 214 52 150 Z"
          fill="var(--panel)"
          stroke="var(--ink)"
          strokeWidth="2"
        />
        <line
          x1="70"
          x2="940"
          y1="196"
          y2="196"
          stroke="var(--ink)"
          strokeWidth="0.5"
          opacity="0.4"
        />
        {/* Hull compartments */}
        {[380, 540, 690, 820].map((x) => (
          <line key={x} x1={x} x2={x} y1="150" y2="222" stroke="var(--ink-3)" strokeWidth="1" />
        ))}
        {/* HX room */}
        <g className={`cut-part ${active === 'hx' ? 'is-on' : ''}`}>
          {Array.from({ length: 9 }, (_, i) => (
            <rect
              key={i}
              x={400 + i * 15}
              y="170"
              width="9"
              height="40"
              fill="none"
              stroke="var(--info)"
              strokeWidth="1.2"
            />
          ))}
        </g>
        {/* Battery */}
        <g className={`cut-part ${active === 'battery' ? 'is-on' : ''}`}>
          {Array.from({ length: 4 }, (_, r) =>
            Array.from({ length: 6 }, (_, c) => (
              <rect
                key={`${r}${c}`}
                x={556 + c * 21}
                y={164 + r * 13}
                width="17"
                height="9"
                fill="var(--battery)"
                opacity="0.75"
              />
            )),
          )}
        </g>
        {/* Gensets */}
        <g className={`cut-part ${active === 'genset' ? 'is-on' : ''}`}>
          {[0, 1].map((i) => (
            <g key={i} transform={`translate(${710 + i * 52},172)`}>
              <rect
                width="42"
                height="34"
                rx="3"
                fill="none"
                stroke="var(--genset)"
                strokeWidth="1.5"
              />
              <circle cx="12" cy="17" r="7" fill="none" stroke="var(--genset)" />
              <circle cx="30" cy="17" r="7" fill="none" stroke="var(--genset)" />
            </g>
          ))}
        </g>

        {/* Compute decks */}
        <g className={`cut-part ${active === 'halls' ? 'is-on' : ''}`}>
          {Array.from({ length: 4 }, (_, deck) => (
            <g key={deck} transform={`translate(190,${126 - deck * 24})`}>
              <rect
                width={560 - (deck === 3 ? 60 : 0)}
                height="22"
                fill="var(--panel-2)"
                stroke="var(--ink)"
                strokeWidth="1"
              />
              {Array.from({ length: deck === 3 ? 25 : 28 }, (_, r) => (
                <g key={r}>
                  <rect
                    x={6 + r * 19.6}
                    y="4"
                    width="13"
                    height="14"
                    fill="var(--ink)"
                    opacity="0.85"
                  />
                  <rect
                    x={9 + r * 19.6}
                    y="7"
                    width="2.4"
                    height="2"
                    className="rack-led"
                    style={{ animationDelay: `${((r * 7 + deck * 13) % 23) / 10}s` }}
                  />
                </g>
              ))}
            </g>
          ))}
        </g>

        {/* Accommodation + helideck */}
        <g className={`cut-part ${active === 'bridge' ? 'is-on' : ''}`}>
          <rect
            x="800"
            y="70"
            width="90"
            height="80"
            fill="var(--panel-2)"
            stroke="var(--ink)"
            strokeWidth="1.5"
          />
          {[0, 1, 2].map((r) =>
            [0, 1, 2, 3, 4].map((c) => (
              <rect
                key={`${r}${c}`}
                x={808 + c * 16}
                y={82 + r * 20}
                width="10"
                height="7"
                fill="var(--sea-3)"
              />
            )),
          )}
          <rect x="786" y="58" width="118" height="10" fill="var(--ink)" />
          <text x="845" y="66" textAnchor="middle" className="cutaway-h">
            H
          </text>
          <line x1="870" x2="870" y1="58" y2="30" stroke="var(--ink)" strokeWidth="2" />
          <circle cx="870" cy="28" r="3" className="mast-light" />
        </g>

        {/* Turret + mooring + cable */}
        <g className={`cut-part ${active === 'turret' ? 'is-on' : ''}`}>
          <rect
            x="108"
            y="134"
            width="40"
            height="88"
            fill="var(--panel-2)"
            stroke="var(--ink)"
            strokeWidth="1.5"
          />
          <circle cx="128" cy="160" r="9" fill="none" stroke="var(--ink)" />
          <path
            d="M112 222 L20 360 M120 222 L70 360 M136 222 L190 360"
            stroke="var(--ink)"
            strokeWidth="1.2"
            strokeDasharray="5 4"
            fill="none"
          />
        </g>
        <g className={`cut-part ${active === 'cable' ? 'is-on' : ''}`}>
          <path
            d="M128 222 C 130 280, 150 320, 240 360"
            stroke="var(--accent)"
            strokeWidth="3"
            fill="none"
          />
          <path
            d="M128 222 C 130 280, 150 320, 240 360"
            stroke="var(--accent-ink)"
            strokeWidth="1"
            fill="none"
            strokeDasharray="2 10"
            className="flow-dash"
          />
        </g>

        {/* Intake pipe to −30 m with flowing water */}
        <g className={`cut-part ${active === 'intake' ? 'is-on' : ''}`}>
          <path
            d="M440 222 V330 H330"
            stroke="var(--info)"
            strokeWidth="7"
            fill="none"
            strokeLinejoin="round"
          />
          <path
            d="M330 330 H440 V222"
            stroke="var(--sea-1)"
            strokeWidth="2"
            fill="none"
            strokeDasharray="4 8"
            className="flow-dash"
          />
          <rect
            x="300"
            y="320"
            width="30"
            height="20"
            fill="none"
            stroke="var(--info)"
            strokeWidth="1.5"
            strokeDasharray="2 2"
          />
        </g>
        {/* Outfall */}
        <g className={`cut-part ${active === 'outfall' ? 'is-on' : ''}`}>
          <path
            d="M860 222 V 280 H 920"
            stroke="var(--warn)"
            strokeWidth="5"
            fill="none"
            opacity="0.8"
          />
          {[0, 1, 2, 3].map((i) => (
            <circle
              key={i}
              cx={930 + i * 10}
              cy={280 - i * 4}
              r={4 + i * 3}
              fill="var(--warn)"
              opacity={0.25 - i * 0.05}
              className="plume"
              style={{ animationDelay: `${i * 0.4}s` }}
            />
          ))}
        </g>

        {/* Hotspots */}
        {PARTS.map((p) => (
          <g
            key={p.id}
            className={`hotspot ${active === p.id ? 'is-active' : ''}`}
            transform={`translate(${p.x},${p.y})`}
            tabIndex={0}
            role="button"
            aria-pressed={active === p.id}
            aria-label={`${p.n}. ${p.title}`}
            onClick={() => setActive(p.id)}
            onMouseEnter={() => setActive(p.id)}
            onFocus={() => setActive(p.id)}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setActive(p.id)}
          >
            <circle r="13" />
            <text y="4.5" textAnchor="middle">
              {p.n}
            </text>
          </g>
        ))}
      </svg>
      <div className="cutaway-detail panel ticked" aria-live="polite">
        <div className="eyebrow">
          System {part.n} of {PARTS.length}
        </div>
        <h3>{part.title}</h3>
        <p className="mono cutaway-spec">{part.spec}</p>
        <p>{part.text}</p>
        <div className="cutaway-nav">
          {PARTS.map((p) => (
            <button
              key={p.id}
              className={active === p.id ? 'is-active' : ''}
              onClick={() => setActive(p.id)}
              aria-label={p.title}
            >
              {p.n}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
