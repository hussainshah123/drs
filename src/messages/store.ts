/**
 * Inbox store — out-of-session messages operators send to this device
 * (POST /v1/devices/:id/messages and bulk sends), delivered by the gateway as
 * SignalMessage.message (docs/gateway.md C6).
 *
 * The gateway re-sends every message that is still `queued` on each connect, so
 * the store dedupes on message_id. Each message carries a local status that
 * only moves forward (delivered → read → acknowledged → dismissed, the same
 * order the server enforces) and the last status the gateway accepted, so acks
 * made while offline are flushed on the next Registered.
 *
 * History the device missed (or lost on reinstall) is filled in from
 * GET /v1/agent/messages via mergeHistory.
 *
 * Mirrored to AsyncStorage so history and pending acks survive restarts.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

export type InboxKind = 'chat' | 'banner' | 'tray' | 'fullscreen';
export type InboxStatus = 'delivered' | 'read' | 'acknowledged' | 'dismissed';

export type InboxMessage = {
  /** messages.id (BIGINT) as a string. */
  id: string;
  kind: InboxKind;
  sender: string;
  text: string;
  templateId?: string;
  receivedAt: number;
  expiresAt?: number;
  status: InboxStatus;
  /** The last status the gateway was sent, or null before the first ack. */
  synced: InboxStatus | null;
  /** This device sent it to the operator (shown as an outgoing bubble). */
  outgoing?: boolean;
  /** An outgoing echo not yet confirmed by the server (temporary local id). */
  pending?: boolean;
};

const STORAGE_KEY = 'drs.inbox.v1';
const MAX_KEPT = 500;

const ORDER: InboxStatus[] = ['delivered', 'read', 'acknowledged', 'dismissed'];
const rank = (s: InboxStatus | null) => (s ? ORDER.indexOf(s) : -1);

let items: InboxMessage[] = [];
let loaded: Promise<void> | null = null;
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
    // best-effort; the inbox keeps working from memory
  }
}

function changed() {
  void persist();
  emit();
}

/** loadInbox reads the persisted inbox once; later calls share the same load. */
export function loadInbox(): Promise<void> {
  if (!loaded) {
    loaded = (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        const parsed = raw ? (JSON.parse(raw) as InboxMessage[]) : null;
        if (Array.isArray(parsed)) {
          items = parsed;
          emit();
        }
      } catch {
        // start empty
      }
    })();
  }
  return loaded;
}

export function subscribeInbox(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Messages oldest first. Pending outgoing ids are non-numeric, so order those by time only. */
export function getInbox(): InboxMessage[] {
  const idNum = (id: string) => {
    const n = Number(id);
    return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
  };
  return [...items].sort((a, b) => a.receivedAt - b.receivedAt || idNum(a.id) - idNum(b.id));
}

export function getInboxMessage(id: string): InboxMessage | undefined {
  return items.find(m => m.id === id);
}

/** Messages the person at the device has not opened yet. */
export function unreadInboxCount(): number {
  return items.reduce((n, m) => n + (m.status === 'delivered' ? 1 : 0), 0);
}

export function isExpired(m: InboxMessage, now = Date.now()): boolean {
  return m.expiresAt !== undefined && m.expiresAt <= now;
}

/** A notification still waiting for the person to acknowledge or dismiss it. */
export function needsAction(m: InboxMessage): boolean {
  return m.kind !== 'chat' && rank(m.status) < rank('acknowledged') && !isExpired(m);
}

/**
 * receive records a message from the gateway. It returns false when the
 * message is a redelivery of one the device already has.
 */
export function receive(m: Omit<InboxMessage, 'status' | 'synced'>): boolean {
  if (items.some(x => x.id === m.id)) {
    return false;
  }
  items.push({...m, status: 'delivered', synced: null});
  if (items.length > MAX_KEPT) {
    items = getInbox().slice(-MAX_KEPT);
  }
  changed();
  return true;
}

/**
 * addOutgoing records a chat message this device just sent to the operator, so
 * it shows at once as an outgoing bubble. The send goes over the socket, which
 * does not return the server id, so the echo gets a temporary `pending` id and
 * carries no delivery/ack state (status and synced are pinned to 'read' and it
 * is never acked). mergeHistory later reconciles it to the real server row.
 */
export function addOutgoing(m: Omit<InboxMessage, 'id' | 'status' | 'synced' | 'outgoing' | 'pending'>): void {
  items.push({
    ...m,
    id: `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    status: 'read',
    synced: 'read',
    outgoing: true,
    pending: true,
  });
  if (items.length > MAX_KEPT) {
    items = getInbox().slice(-MAX_KEPT);
  }
  changed();
}

/** A message as GET /v1/agent/messages reports it. */
export type HistoryRow = Omit<InboxMessage, 'status' | 'synced'> & {
  /** The server's status; null while it is still queued (never acked). */
  serverStatus: InboxStatus | null;
  /** The server expired it; it can no longer be acked. */
  expired: boolean;
};

/**
 * mergeHistory folds rows from the history API into the inbox. The server is
 * the record of what was already acked, so a local status behind it catches
 * up, and statuses it already holds are not sent again.
 */
export function mergeHistory(rows: HistoryRow[]): void {
  if (rows.length === 0) {
    return;
  }
  for (const {serverStatus, expired, ...row} of rows) {
    const m = items.find(x => x.id === row.id);
    if (!m) {
      // Outgoing (this device's own replies) carry no ack state: pin them so
      // they are never acked and render as outgoing bubbles.
      if (row.outgoing) {
        // Reconcile a pending echo (temporary id) with its real server row so
        // the message is not shown twice.
        const echo = items.find(
          x => x.pending && x.outgoing && x.text === row.text,
        );
        if (echo) {
          echo.id = row.id;
          echo.receivedAt = row.receivedAt;
          echo.pending = false;
          continue;
        }
        const status = serverStatus ?? 'read';
        items.push({...row, status, synced: status});
        continue;
      }
      const status = serverStatus ?? 'delivered';
      items.push({...row, status, synced: expired ? status : serverStatus});
      continue;
    }
    m.receivedAt = row.receivedAt;
    m.expiresAt = row.expiresAt;
    if (m.outgoing || row.outgoing) {
      continue; // nothing to ack or advance on an outgoing message
    }
    if (rank(serverStatus) > rank(m.status)) {
      m.status = serverStatus as InboxStatus;
    }
    if (expired) {
      m.synced = m.status;
    } else if (rank(serverStatus) > rank(m.synced)) {
      m.synced = serverStatus;
    }
  }
  if (items.length > MAX_KEPT) {
    items = getInbox().slice(-MAX_KEPT);
  }
  changed();
}

/** Paging state of the history API, for the inbox screen (not persisted). */
export type HistoryState = {
  /** Cursor of the next older page; null when there is none, undefined before the first load. */
  cursor: string | null | undefined;
  loading: boolean;
  error: string | null;
};

let history: HistoryState = {cursor: undefined, loading: false, error: null};

export function getHistoryState(): HistoryState {
  return history;
}

export function setHistoryState(p: Partial<HistoryState>): void {
  history = {...history, ...p};
  emit();
}

/** advance moves a message to status if that is forward; returns whether it moved. */
export function advance(id: string, status: InboxStatus): boolean {
  const m = items.find(x => x.id === id);
  if (!m || rank(status) <= rank(m.status)) {
    return false;
  }
  m.status = status;
  changed();
  return true;
}

/** markSynced records that the gateway was sent status for a message. */
export function markSynced(id: string, status: InboxStatus): void {
  const m = items.find(x => x.id === id);
  if (m && rank(status) > rank(m.synced)) {
    m.synced = status;
    void persist();
  }
}

/** Messages whose local status is ahead of what the gateway was told. */
export function unsynced(): InboxMessage[] {
  return items.filter(m => !m.outgoing && rank(m.status) > rank(m.synced));
}

/** clearInbox forgets every message (on unenroll). */
export async function clearInbox(): Promise<void> {
  items = [];
  history = {cursor: undefined, loading: false, error: null};
  emit();
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {}
}
