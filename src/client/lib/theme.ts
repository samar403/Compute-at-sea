import { useCallback, useEffect, useState } from 'react';

export type Palette = 'day' | 'dusk' | 'night';
export const PALETTES: Array<{ id: Palette; label: string; hint: string }> = [
  { id: 'day', label: 'Day', hint: 'Paper chart' },
  { id: 'dusk', label: 'Dusk', hint: 'Bridge glass' },
  { id: 'night', label: 'Night', hint: 'ECDIS red — keeps night vision' },
];

const KEY = 'cas.palette';

function initial(): Palette {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'day' || saved === 'dusk' || saved === 'night') return saved;
  } catch {
    /* storage unavailable */
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dusk' : 'day';
}

export function usePalette(): [Palette, (p: Palette) => void, () => void] {
  const [palette, setPalette] = useState<Palette>(initial);
  useEffect(() => {
    document.documentElement.dataset.theme = palette;
    const meta = document.querySelector('meta[name="theme-color"]');
    meta?.setAttribute(
      'content',
      getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(),
    );
    try {
      localStorage.setItem(KEY, palette);
    } catch {
      /* ignore */
    }
  }, [palette]);
  const cycle = useCallback(
    () => setPalette((p) => (p === 'day' ? 'dusk' : p === 'dusk' ? 'night' : 'day')),
    [],
  );
  return [palette, setPalette, cycle];
}

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
  );
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!mq) return;
    const on = () => setReduced(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return reduced;
}

/** Read a CSS custom property, re-evaluated when the palette changes. */
export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
