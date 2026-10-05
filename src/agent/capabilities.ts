/**
 * Session capability bits (docs/architecture.md §1.15, internal/capability).
 * Only the bits the Android agent acts on are named here. Bits are permanent.
 */
export const Cap = {
  VIEW_SCREEN: 1 << 0, // view_screen
  CONTROL_INPUT: 1 << 1, // control_input
  CLIPBOARD: 1 << 2,
  FILE_TRANSFER: 1 << 3,
  RECORD_SESSION: 1 << 12,
} as const;

export function can(permissions: number, bit: number): boolean {
  // Bitwise on numbers is 32-bit safe for the low bits the agent uses.
  return (permissions & bit) !== 0;
}
