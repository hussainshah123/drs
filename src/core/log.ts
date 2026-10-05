/**
 * Tiny in-memory + console logger. The UI subscribes to show a live activity
 * log on the agent's status screen; everything also goes to the console.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogEntry = {ts: number; level: LogLevel; tag: string; msg: string};

type Listener = (e: LogEntry) => void;

const MAX = 300;
const buffer: LogEntry[] = [];
const listeners = new Set<Listener>();

function emit(level: LogLevel, tag: string, msg: string) {
  const e: LogEntry = {ts: Date.now(), level, tag, msg};
  buffer.push(e);
  if (buffer.length > MAX) {
    buffer.shift();
  }
  // eslint-disable-next-line no-console
  (console[level === 'debug' ? 'log' : level] || console.log)(`[${tag}] ${msg}`);
  listeners.forEach(l => l(e));
}

export const log = {
  debug: (tag: string, msg: string) => emit('debug', tag, msg),
  info: (tag: string, msg: string) => emit('info', tag, msg),
  warn: (tag: string, msg: string) => emit('warn', tag, msg),
  error: (tag: string, msg: string) => emit('error', tag, msg),
};

export function recentLogs(): LogEntry[] {
  return buffer.slice();
}

export function subscribeLogs(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
