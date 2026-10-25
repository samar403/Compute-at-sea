export const fmt = (n: number, digits = 1): string =>
  Number.isFinite(n)
    ? n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
    : '—';

export const int = (n: number): string =>
  Number.isFinite(n) ? Math.round(n).toLocaleString('en-US') : '—';

export const usd = (n: number, digits = 0): string =>
  Number.isFinite(n)
    ? n.toLocaleString('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      })
    : '—';

export const usdCompact = (n: number): string => {
  const a = Math.abs(n);
  const sign = n < 0 ? '−' : '';
  if (a >= 1e9) return `${sign}$${fmt(a / 1e9, 2)}B`;
  if (a >= 1e6) return `${sign}$${fmt(a / 1e6, 1)}M`;
  if (a >= 1e3) return `${sign}$${fmt(a / 1e3, 0)}k`;
  return `${sign}$${fmt(a, 0)}`;
};

export const compact = (n: number): string =>
  n.toLocaleString('en-US', { notation: 'compact', maximumFractionDigits: 1 });

export const pct = (x: number, digits = 0): string => `${fmt(x * 100, digits)} %`;

/** Simulated ship's time, always UTC, written like a log entry. */
export const logTime = (t: number): string => {
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCHours())}${p(d.getUTCMinutes())}Z`;
};

export const logDate = (t: number): string =>
  new Date(t)
    .toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    })
    .toUpperCase();

export const hourLabel = (t: number): string => {
  const d = new Date(t);
  return `${String(d.getUTCHours()).padStart(2, '0')}Z`;
};
