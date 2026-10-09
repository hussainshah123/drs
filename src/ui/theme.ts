/** Design tokens for the agent UI — an orange / black / white look. */
export const T = {
  // Surfaces (black → charcoal)
  bg: '#0A0A0B',
  bgElev: '#121214',
  card: '#1A1A1D',
  cardAlt: '#232327',
  border: '#2B2B30',
  borderSoft: '#1E1E22',

  // Text (white → grey)
  text: '#FFFFFF',
  textDim: '#A7A7AE',
  textFaint: '#6C6C74',

  // Brand + status (orange accent)
  accent: '#FF7A1A',
  accentSoft: 'rgba(255,122,26,0.14)',
  violet: '#FF9F45',
  good: '#32D583',
  goodSoft: 'rgba(50,213,131,0.14)',
  warn: '#F5B544',
  warnSoft: 'rgba(245,181,68,0.14)',
  bad: '#FF5A5A',
  badSoft: 'rgba(255,90,90,0.14)',

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
