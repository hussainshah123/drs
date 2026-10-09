/**
 * Notifications store — local, backend-free. Mirrors to AsyncStorage so the
 * read/unread state survives restarts. Swap for push/API when a backend exists.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

export type NotifKind = 'message' | 'session' | 'device' | 'system';

export type Notif = {
  id: string;
  kind: NotifKind;
  title: string;
  body: string;
  ts: number;
  read: boolean;
};

const STORAGE_KEY = 'drs.notifs.v1';

function seed(): Notif[] {
  const now = Date.now();
  return [
    {id: 'n1', kind: 'message', title: 'New message', body: 'Sara Malik: Almost done, 10 min me bhejti hoon.', ts: now - 1500000, read: false},
    {id: 'n2', kind: 'session', title: 'Session started', body: 'An operator connected to this device.', ts: now - 5400000, read: false},
    {id: 'n3', kind: 'message', title: 'Field Ops', body: 'Bilal Ahmed: Team, status update chahiye.', ts: now - 9000000, read: false},
    {id: 'n4', kind: 'device', title: 'Device online', body: 'This device is connected to the gateway.', ts: now - 86400000, read: true},
    {id: 'n5', kind: 'system', title: 'Welcome to Desktop Remote', body: 'Your device is enrolled and ready.', ts: now - 172800000, read: true},
  ];
}

let items: Notif[] = seed();
let loaded = false;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) {
    l();
  }
}

async function persist() {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // best-effort
  }
}

export async function loadNotifs(): Promise<void> {
  if (loaded) {
    return;
  }
  loaded = true;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Notif[];
      if (Array.isArray(parsed)) {
        items = parsed;
        emit();
      }
    } else {
      await persist();
    }
  } catch {
    // keep seed
  }
}

export function subscribeNotifs(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function getNotifs(): Notif[] {
  return [...items].sort((a, b) => b.ts - a.ts);
}

export function unreadCount(): number {
  return items.reduce((n, x) => n + (x.read ? 0 : 1), 0);
}

export function markRead(id: string): void {
  const n = items.find(x => x.id === id);
  if (n && !n.read) {
    n.read = true;
    void persist();
    emit();
  }
}

export function markAllRead(): void {
  let changed = false;
  for (const n of items) {
    if (!n.read) {
      n.read = true;
      changed = true;
    }
  }
  if (changed) {
    void persist();
    emit();
  }
}

export function clearAll(): void {
  items = [];
  void persist();
  emit();
}
