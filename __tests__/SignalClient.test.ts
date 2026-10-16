import {SignalClient} from '../src/signal/client';
import type {DeviceToken} from '../src/core/token';

type SocketEvent = {code?: number; reason?: string; data?: ArrayBuffer};

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: SocketEvent) => void) | null = null;
  onerror: ((event: {message?: string}) => void) | null = null;
  onclose: ((event: SocketEvent) => void) | null = null;

  constructor() {
    FakeWebSocket.instances.push(this);
  }

  close(code = 1000, reason = '') {
    this.readyState = 3;
    this.onclose?.({code, reason});
  }

  send() {}
}

describe('SignalClient', () => {
  const originalWebSocket = globalThis.WebSocket;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(console, 'info').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    FakeWebSocket.instances = [];
    Object.defineProperty(globalThis, 'WebSocket', {
      configurable: true,
      value: FakeWebSocket,
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    Object.defineProperty(globalThis, 'WebSocket', {
      configurable: true,
      value: originalWebSocket,
    });
  });

  it('does not reconnect after the gateway replaces a stale client', async () => {
    const token: DeviceToken = {
      token: 'device-token',
      expiresAt: Date.now() + 900_000,
      gatewayUrl: 'wss://gateway.example/ws',
    };
    const getToken = jest.fn(async () => token);
    const client = new SignalClient(getToken, {
      hostname: 'phone',
      lastUser: 'user',
      osVersion: 'Android',
      agentVersion: '1.0',
    }, {});

    client.start();
    client.start();
    await Promise.resolve();
    await Promise.resolve();

    expect(FakeWebSocket.instances).toHaveLength(1);
    const socket = FakeWebSocket.instances[0];
    socket.onopen?.();
    socket.close(4004, 'replaced by a newer connection');

    expect(client.getStatus()).toBe('closed');
    jest.advanceTimersByTime(30_000);
    await Promise.resolve();

    expect(getToken).toHaveBeenCalledTimes(1);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });
});
