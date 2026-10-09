/**
 * Chat design tokens — a focused orange / black / white palette, kept separate
 * from the operator-console theme (T) so the messaging surface has its own
 * identity. Black surfaces, white type, orange as the single accent.
 */
export const C = {
  // Surfaces (black → charcoal)
  bg: '#0A0A0B',
  bgElev: '#121214',
  surface: '#1A1A1D',
  surfaceAlt: '#232327',
  border: '#2B2B30',
  borderSoft: '#1E1E22',

  // Type (white → grey)
  text: '#FFFFFF',
  textDim: '#A7A7AE',
  textFaint: '#6C6C74',

  // Accent (orange)
  orange: '#FF7A1A',
  orangeDeep: '#E85F00',
  orangeSoft: 'rgba(255,122,26,0.14)',
  orangeLine: 'rgba(255,122,26,0.35)',
  onOrange: '#1A0E00',

  // Bubbles
  bubbleIn: '#1D1D21',
  bubbleOut: '#FF7A1A',

  // Status
  online: '#32D583',
  unread: '#FF7A1A',
  danger: '#FF5A5A',

  // Metrics
  space: 16,
  radius: 16,
  radiusLg: 22,
};

/** A small, deterministic accent for an avatar, biased to warm/orange tones. */
const AVATAR_COLORS = ['#FF7A1A', '#FF9F45', '#F76E6E', '#E0A458', '#C98A3B', '#FFB067', '#D98324'];
export function avatarColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

/** Initials from a display name, for avatars. */
export function chatInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return '?';
  }
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Short relative time label (e.g. "now", "4m", "2h", "Mon", "12/4"). */
export function relTime(ts: number): string {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) {
    return 'now';
  }
  if (m < 60) {
    return `${m}m`;
  }
  const h = Math.floor(m / 60);
  if (h < 24) {
    return `${h}h`;
  }
  const d = new Date(ts);
  const days = Math.floor(h / 24);
  if (days < 7) {
    return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()];
  }
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/** Clock label for a message bubble (e.g. "9:41 PM"). */
export function clockTime(ts: number): string {
  const d = new Date(ts);
  let h = d.getHours();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${String(d.getMinutes()).padStart(2, '0')} ${ampm}`;
}

/** Day divider label (e.g. "Today", "Yesterday", "Dec 4"). */
export function dayLabel(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(d)) / 86400000);
  if (days === 0) {
    return 'Today';
  }
  if (days === 1) {
    return 'Yesterday';
  }
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[d.getMonth()]} ${d.getDate()}`;
}
