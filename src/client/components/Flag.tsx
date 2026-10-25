/**
 * International Code of Signals flags, drawn to proportion (3:2).
 * Each section of the app flies the flag whose meaning fits it.
 */
export type FlagLetter = 'A' | 'H' | 'P' | 'C' | 'E' | 'R' | 'K';

export const FLAG_MEANING: Record<FlagLetter, { name: string; meaning: string }> = {
  A: { name: 'Alfa', meaning: 'I have a diver down; keep well clear at slow speed.' },
  H: { name: 'Hotel', meaning: 'I have a pilot on board.' },
  P: {
    name: 'Papa',
    meaning: 'All persons should report on board; the vessel is about to proceed to sea.',
  },
  C: { name: 'Charlie', meaning: 'Affirmative.' },
  E: { name: 'Echo', meaning: 'I am altering my course to starboard.' },
  R: { name: 'Romeo', meaning: 'No single-flag meaning — used in the phonetic alphabet.' },
  K: { name: 'Kilo', meaning: 'I wish to communicate with you.' },
};

const BLUE = '#1f4e9c';
const RED = '#c8202f';
const YELLOW = '#f2c418';
const WHITE = '#f8f6ef';

export function Flag({
  letter,
  size = 22,
  title,
}: {
  letter: FlagLetter;
  size?: number;
  title?: string;
}) {
  const w = size * 1.5;
  const h = size;
  const body = (() => {
    switch (letter) {
      case 'A':
        return (
          <>
            <rect width="15" height="20" fill={WHITE} />
            <path d="M15 0 H30 L22 10 L30 20 H15 Z" fill={BLUE} />
          </>
        );
      case 'H':
        return (
          <>
            <rect width="15" height="20" fill={WHITE} />
            <rect x="15" width="15" height="20" fill={RED} />
          </>
        );
      case 'P':
        return (
          <>
            <rect width="30" height="20" fill={BLUE} />
            <rect x="10" y="6.67" width="10" height="6.66" fill={WHITE} />
          </>
        );
      case 'C':
        return (
          <>
            <rect width="30" height="20" fill={BLUE} />
            <rect y="4" width="30" height="12" fill={WHITE} />
            <rect y="8" width="30" height="4" fill={RED} />
          </>
        );
      case 'E':
        return (
          <>
            <rect width="30" height="10" fill={BLUE} />
            <rect y="10" width="30" height="10" fill={RED} />
          </>
        );
      case 'R':
        return (
          <>
            <rect width="30" height="20" fill={RED} />
            <rect x="12.5" width="5" height="20" fill={YELLOW} />
            <rect y="7.5" width="30" height="5" fill={YELLOW} />
          </>
        );
      case 'K':
        return (
          <>
            <rect width="15" height="20" fill={YELLOW} />
            <rect x="15" width="15" height="20" fill={BLUE} />
          </>
        );
    }
  })();
  const m = FLAG_MEANING[letter];
  return (
    <svg
      className="flag"
      width={w}
      height={h}
      viewBox="0 0 30 20"
      role="img"
      aria-label={title ?? `Signal flag ${m.name}`}
      style={{ filter: 'var(--flag-filter)' }}
    >
      <title>{`${m.name} — ${m.meaning}`}</title>
      {body}
      <rect
        x="0.25"
        y="0.25"
        width="29.5"
        height="19.5"
        fill="none"
        stroke="rgba(0,0,0,.25)"
        strokeWidth="0.5"
      />
    </svg>
  );
}
