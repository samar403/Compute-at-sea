import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { FLEET } from '../../shared/fleet';
import type { FleetSnapshot, Telemetry, VesselSpec } from '../../shared/types';

export type LinkState = 'connecting' | 'live' | 'reconnecting';

interface FleetContextValue {
  specs: VesselSpec[];
  snapshot: FleetSnapshot | null;
  link: LinkState;
  /** Wall-clock ms when the last snapshot arrived (for "last fix" readouts). */
  receivedAt: number;
  byId: (id: string) => { spec: VesselSpec; tm: Telemetry | undefined } | undefined;
}

const FleetContext = createContext<FleetContextValue | null>(null);

/**
 * One EventSource for the whole app. The browser reconnects SSE on its own;
 * we only surface the link state so the UI can say so honestly.
 */
export function FleetProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<FleetSnapshot | null>(null);
  const [link, setLink] = useState<LinkState>('connecting');
  const [receivedAt, setReceivedAt] = useState(0);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const es = new EventSource('/api/stream');
    esRef.current = es;
    es.addEventListener('snapshot', (e) => {
      setSnapshot(JSON.parse((e as MessageEvent).data) as FleetSnapshot);
      setReceivedAt(Date.now());
      setLink('live');
    });
    es.onerror = () => setLink('reconnecting');
    return () => es.close();
  }, []);

  const value = useMemo<FleetContextValue>(() => {
    const map = new Map(snapshot?.vessels.map((v) => [v.vesselId, v]));
    return {
      specs: FLEET,
      snapshot,
      link,
      receivedAt,
      byId: (id) => {
        const spec = FLEET.find((v) => v.id === id);
        return spec ? { spec, tm: map.get(id) } : undefined;
      },
    };
  }, [snapshot, link, receivedAt]);

  return <FleetContext.Provider value={value}>{children}</FleetContext.Provider>;
}

export function useFleet(): FleetContextValue {
  const ctx = useContext(FleetContext);
  if (!ctx) throw new Error('useFleet must be used inside <FleetProvider>');
  return ctx;
}
