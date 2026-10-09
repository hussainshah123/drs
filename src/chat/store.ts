/**
 * Chat store — a fully local, backend-free message store for the admin.
 *
 * Everything lives in memory and is mirrored to AsyncStorage so conversations
 * survive app restarts. There is NO network: this is the mobile UI only. Swap
 * these functions for real API/websocket calls when a backend exists.
 *
 * The admin ("me") can:
 *   - open / start a direct chat with a specific user,
 *   - create a group and add members,
 *   - send messages into any conversation.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

export const ME_ID = 'admin';

export type ChatUser = {
  id: string;
  name: string;
  role: 'admin' | 'user';
  handle: string;
  online: boolean;
};

export type Message = {
  id: string;
  conversationId: string;
  senderId: string;
  text: string;
  ts: number;
};

export type Conversation = {
  id: string;
  kind: 'dm' | 'group';
  /** Group name; for DMs the title is derived from the other member. */
  title?: string;
  memberIds: string[];
  createdBy: string;
  createdAt: number;
};

type DB = {
  users: ChatUser[];
  conversations: Conversation[];
  messages: Message[];
};

const STORAGE_KEY = 'drs.chat.v1';

// ---- seed data -------------------------------------------------------------

const SEED_USERS: ChatUser[] = [
  {id: ME_ID, name: 'Admin', role: 'admin', handle: 'admin', online: true},
  {id: 'u_ayesha', name: 'Ayesha Khan', role: 'user', handle: 'ayesha', online: true},
  {id: 'u_bilal', name: 'Bilal Ahmed', role: 'user', handle: 'bilal', online: false},
  {id: 'u_sara', name: 'Sara Malik', role: 'user', handle: 'sara', online: true},
  {id: 'u_usman', name: 'Usman Tariq', role: 'user', handle: 'usman', online: false},
  {id: 'u_hina', name: 'Hina Raza', role: 'user', handle: 'hina', online: true},
  {id: 'u_zain', name: 'Zain Ali', role: 'user', handle: 'zain', online: false},
  {id: 'u_mariam', name: 'Mariam Noor', role: 'user', handle: 'mariam', online: true},
];

function seed(): DB {
  const now = Date.now();
  const users = SEED_USERS;
  const conversations: Conversation[] = [
    {id: 'c_ayesha', kind: 'dm', memberIds: [ME_ID, 'u_ayesha'], createdBy: ME_ID, createdAt: now - 86400000},
    {id: 'c_ops', kind: 'group', title: 'Field Ops', memberIds: [ME_ID, 'u_bilal', 'u_sara', 'u_usman'], createdBy: ME_ID, createdAt: now - 172800000},
    {id: 'c_sara', kind: 'dm', memberIds: [ME_ID, 'u_sara'], createdBy: ME_ID, createdAt: now - 3600000},
  ];
  const messages: Message[] = [
    {id: 'm1', conversationId: 'c_ayesha', senderId: 'u_ayesha', text: 'Assalam o Alaikum! Device enroll ho gaya hai ✅', ts: now - 7200000},
    {id: 'm2', conversationId: 'c_ayesha', senderId: ME_ID, text: 'Walaikum salam. Great — screen share test kar lein.', ts: now - 7000000},
    {id: 'm3', conversationId: 'c_ayesha', senderId: 'u_ayesha', text: 'Ji, abhi karti hoon.', ts: now - 6900000},
    {id: 'm4', conversationId: 'c_ops', senderId: 'u_bilal', text: 'Team, aaj ke devices ka status update chahiye.', ts: now - 9000000},
    {id: 'm5', conversationId: 'c_ops', senderId: 'u_sara', text: 'Mere 3 devices online hain.', ts: now - 8700000},
    {id: 'm6', conversationId: 'c_ops', senderId: ME_ID, text: 'Shukriya. Usman apna bhi bata dein.', ts: now - 8600000},
    {id: 'm7', conversationId: 'c_sara', senderId: ME_ID, text: 'Sara, kal ki report ready hai?', ts: now - 1800000},
    {id: 'm8', conversationId: 'c_sara', senderId: 'u_sara', text: 'Almost done, 10 min me bhejti hoon.', ts: now - 1500000},
  ];
  return {users, conversations, messages};
}

// ---- in-memory state + persistence ----------------------------------------

let db: DB = seed();
let loaded = false;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) {
    l();
  }
}

async function persist() {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  } catch {
    // best-effort; UI keeps working from memory
  }
}

/** Load persisted chat data once. Safe to call repeatedly. */
export async function loadChat(): Promise<void> {
  if (loaded) {
    return;
  }
  loaded = true;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as DB;
      if (parsed && parsed.users && parsed.conversations && parsed.messages) {
        db = parsed;
        emit();
      }
    } else {
      await persist();
    }
  } catch {
    // keep seed db
  }
}

export function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

// ---- selectors -------------------------------------------------------------

export function getUsers(): ChatUser[] {
  return db.users;
}

export function getUser(id: string): ChatUser | undefined {
  return db.users.find(u => u.id === id);
}

/** Users other than the admin — the people the admin can message. */
export function getContacts(): ChatUser[] {
  return db.users.filter(u => u.id !== ME_ID);
}

export function getMessages(conversationId: string): Message[] {
  return db.messages
    .filter(m => m.conversationId === conversationId)
    .sort((a, b) => a.ts - b.ts);
}

export function lastMessage(conversationId: string): Message | undefined {
  const list = getMessages(conversationId);
  return list.length ? list[list.length - 1] : undefined;
}

/** Display title + subtitle for a conversation, resolving DM counterpart. */
export function conversationMeta(c: Conversation): {title: string; subtitle: string} {
  if (c.kind === 'group') {
    return {title: c.title || 'Group', subtitle: `${c.memberIds.length} members`};
  }
  const otherId = c.memberIds.find(id => id !== ME_ID);
  const other = otherId ? getUser(otherId) : undefined;
  return {
    title: other?.name || 'Unknown',
    subtitle: other?.online ? 'Online' : `@${other?.handle || ''}`,
  };
}

/** Conversations ordered by most-recent activity. */
export function getConversations(): Conversation[] {
  return [...db.conversations].sort((a, b) => {
    const am = lastMessage(a.id)?.ts ?? a.createdAt;
    const bm = lastMessage(b.id)?.ts ?? b.createdAt;
    return bm - am;
  });
}

export function getConversation(id: string): Conversation | undefined {
  return db.conversations.find(c => c.id === id);
}

// ---- mutations -------------------------------------------------------------

function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/** Open an existing DM with a user or create one. Returns the conversation id. */
export function openDirect(userId: string): string {
  const existing = db.conversations.find(
    c => c.kind === 'dm' && c.memberIds.includes(userId) && c.memberIds.includes(ME_ID),
  );
  if (existing) {
    return existing.id;
  }
  const conv: Conversation = {
    id: uid('c'),
    kind: 'dm',
    memberIds: [ME_ID, userId],
    createdBy: ME_ID,
    createdAt: Date.now(),
  };
  db.conversations.push(conv);
  void persist();
  emit();
  return conv.id;
}

/** Create a group with the given name and member ids (admin added implicitly). */
export function createGroup(name: string, memberIds: string[]): string {
  const members = Array.from(new Set([ME_ID, ...memberIds]));
  const conv: Conversation = {
    id: uid('g'),
    kind: 'group',
    title: name.trim() || 'New Group',
    memberIds: members,
    createdBy: ME_ID,
    createdAt: Date.now(),
  };
  db.conversations.push(conv);
  void persist();
  emit();
  return conv.id;
}

/** Send a message from the admin into a conversation. */
export function sendMessage(conversationId: string, text: string): void {
  const body = text.trim();
  if (!body) {
    return;
  }
  const msg: Message = {
    id: uid('m'),
    conversationId,
    senderId: ME_ID,
    text: body,
    ts: Date.now(),
  };
  db.messages.push(msg);
  void persist();
  emit();
}
