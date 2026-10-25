import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { Route, Routes } from 'react-router-dom';
import { BridgeOfficer } from './components/BridgeOfficer';
import { CommandPalette } from './components/CommandPalette';
import { Shell } from './components/Shell';
import { FleetProvider } from './lib/fleet';
import { usePalette } from './lib/theme';

const Descent = lazy(() => import('./pages/Descent'));
const Bridge = lazy(() => import('./pages/Bridge'));
const Berth = lazy(() => import('./pages/Berth'));
const Router = lazy(() => import('./pages/Router'));
const Charter = lazy(() => import('./pages/Charter'));
const Ledger = lazy(() => import('./pages/Ledger'));
const NotFound = lazy(() => import('./pages/NotFound'));

function Loading() {
  return (
    <div className="page-loading" role="status">
      <span className="spinner" />
      <span className="mono faint">Taking soundings…</span>
    </div>
  );
}

export function App() {
  const [palette, setPalette] = usePalette();
  const [cmdk, setCmdk] = useState(false);
  const [officer, setOfficer] = useState(false);
  const [seed, setSeed] = useState<{ prompt: string; n: number } | null>(null);

  const openOfficer = useCallback((prompt?: string) => {
    setOfficer(true);
    if (prompt) setSeed((s) => ({ prompt, n: (s?.n ?? 0) + 1 }));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCmdk((o) => !o);
      }
    };
    const onAsk = (e: Event) => openOfficer((e as CustomEvent<string>).detail);
    window.addEventListener('keydown', onKey);
    window.addEventListener('cas:ask', onAsk);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('cas:ask', onAsk);
    };
  }, [openOfficer]);

  return (
    <FleetProvider>
      <Shell
        palette={palette}
        setPalette={setPalette}
        onOpenPalette={() => setCmdk(true)}
        onOpenOfficer={() => setOfficer((o) => !o)}
      >
        <Suspense fallback={<Loading />}>
          <Routes>
            <Route path="/" element={<Descent />} />
            <Route path="/bridge" element={<Bridge />} />
            <Route path="/berth" element={<Berth />} />
            <Route path="/router" element={<Router />} />
            <Route path="/charter" element={<Charter />} />
            <Route path="/ledger" element={<Ledger />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </Shell>
      <CommandPalette
        open={cmdk}
        onClose={() => setCmdk(false)}
        setPalette={setPalette}
        openOfficer={openOfficer}
      />
      <BridgeOfficer open={officer} onClose={() => setOfficer(false)} seed={seed} />
    </FleetProvider>
  );
}
