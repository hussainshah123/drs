/**
 * REST client for the agent-facing API (docs/rest-apis.md "M2a agent API").
 *
 * Enrollment and token exchange are public; /agent/config needs the device JWT.
 * Response and error shapes mirror services/api/internal/agent.
 */
import {log} from './log';

export type EnrollInput = {
  enrollment_token?: string;
  join_token?: string;
  device_uuid: string;
  public_key: string; // base64 Ed25519 public key (Go []byte)
  platform: 'android' | 'ios';
  hostname?: string;
  os_version?: string;
  agent_version: string;
  mac_addresses?: string[];
  enrollment?: 'attended' | 'unattended';
};

export type EnrollResult = {
  device_id: string;
  tenant_id: string;
  gateway_url: string;
  device_credential: string; // first device JWT
};

export type Challenge = {nonce: string; expires_at: string};

export type TokenResult = {
  token: string;
  expires_in: number;
  gateway_url: string;
};

export type AgentConfig = {
  settings: {[key: string]: unknown};
  capabilities_default: number;
  protocol_version: string;
};

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export class Api {
  constructor(private baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  async enroll(input: EnrollInput): Promise<EnrollResult> {
    return this.post<EnrollResult>('/v1/agent/enroll', input);
  }

  async challenge(deviceId: string): Promise<Challenge> {
    return this.get<Challenge>(
      `/v1/agent/token?device_id=${encodeURIComponent(deviceId)}`,
    );
  }

  async token(
    deviceId: string,
    nonce: string,
    signatureB64: string,
  ): Promise<TokenResult> {
    return this.post<TokenResult>('/v1/agent/token', {
      device_id: deviceId,
      nonce,
      signature: signatureB64, // Go []byte -> base64
    });
  }

  async config(deviceJwt: string): Promise<AgentConfig> {
    return this.get<AgentConfig>('/v1/agent/config', deviceJwt);
  }

  private async get<T>(path: string, bearer?: string): Promise<T> {
    return this.request<T>('GET', path, undefined, bearer);
  }

  private async post<T>(path: string, body: unknown, bearer?: string): Promise<T> {
    return this.request<T>('POST', path, body, bearer);
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    bearer?: string,
  ): Promise<T> {
    const url = this.baseUrl + path;
    const headers: Record<string, string> = {'Content-Type': 'application/json'};
    if (bearer) {
      headers.Authorization = `Bearer ${bearer}`;
    }
    log.info('api', `→ ${method} ${url}${bearer ? '  (auth: device JWT)' : ''}`);
    if (body !== undefined) {
      log.debug('api', `  request body: ${redact(body)}`);
    }
    const started = Date.now();
    let resp: Response;
    try {
      resp = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (e: any) {
      log.error('api', `✗ ${method} ${path} network error: ${e?.message || e}`);
      throw new ApiError(0, 'network', `network error: ${e?.message || e}`);
    }
    const ms = Date.now() - started;
    const text = await resp.text();
    let json: any = undefined;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        // non-JSON body
      }
    }
    if (resp.status < 200 || resp.status >= 300) {
      const code = json?.error?.code || 'http_error';
      const msg = json?.error?.message || `HTTP ${resp.status}`;
      const reqId = json?.error?.request_id ? ` [req ${json.error.request_id}]` : '';
      log.error('api', `✗ ${resp.status} ${method} ${path} — ${code}: ${msg}${reqId} (${ms}ms)`);
      throw new ApiError(resp.status, code, msg);
    }
    log.info('api', `✓ ${resp.status} ${method} ${path} (${ms}ms) → ${redact(json)}`);
    return json as T;
  }
}

/** redact serialises a body/response for logs, hiding secrets and shortening tokens. */
function redact(v: unknown): string {
  try {
    const clone = JSON.parse(JSON.stringify(v ?? null));
    const hide = (o: any) => {
      if (!o || typeof o !== 'object') {
        return;
      }
      for (const k of Object.keys(o)) {
        const lk = k.toLowerCase();
        if (/token|secret|signature|public_key|credential|password/.test(lk) && typeof o[k] === 'string') {
          o[k] = o[k].length > 12 ? o[k].slice(0, 6) + '…(' + o[k].length + ')' : '…';
        } else if (typeof o[k] === 'object') {
          hide(o[k]);
        }
      }
    };
    hide(clone);
    const s = JSON.stringify(clone);
    return s.length > 400 ? s.slice(0, 400) + '…' : s;
  } catch {
    return '[unserialisable]';
  }
}
