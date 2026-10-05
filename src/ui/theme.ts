/** Design tokens for the agent UI — a modern, dark operator-console look. */
export const T = {
  // Surfaces
  bg: '#090c14',
  bgElev: '#0e131f',
  card: '#141b2b',
  cardAlt: '#1a2336',
  border: '#232e47',
  borderSoft: '#1b2437',

  // Text
  text: '#eef2fb',
  textDim: '#8a97b1',
  textFaint: '#5c6882',

  // Brand + status
  accent: '#5b8cff',
  accentSoft: 'rgba(91,140,255,0.14)',
  violet: '#9d7bff',
  good: '#35d0a5',
  goodSoft: 'rgba(53,208,165,0.14)',
  warn: '#f5b544',
  warnSoft: 'rgba(245,181,68,0.14)',
  bad: '#ff6b6b',
  badSoft: 'rgba(255,107,107,0.14)',

  // Metrics
  space: 16,
  radius: 16,
  radiusLg: 22,
};

/** Initials from a display name, for avatars. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return '?';
  }
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
