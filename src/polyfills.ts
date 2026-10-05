/**
 * Runtime polyfills that must load before anything else.
 *
 * Hermes (React Native) does not ship TextDecoder/TextEncoder, but protobufjs
 * constructs `new TextDecoder("utf-8", …)` at module-load time
 * (protobufjs/src/util/utf8.js), which throws a ReferenceError and breaks the
 * whole signalling module. We install minimal, correct UTF-8 implementations on
 * the global object if they are missing. Import this FIRST in index.js, before
 * any module that pulls in protobufjs.
 */

/* eslint-disable no-bitwise */

const g: any = globalThis as any;

if (typeof g.TextEncoder === 'undefined') {
  g.TextEncoder = class TextEncoder {
    readonly encoding = 'utf-8';
    encode(input = ''): Uint8Array {
      const str = String(input);
      const out: number[] = [];
      for (let i = 0; i < str.length; i++) {
        let c = str.charCodeAt(i);
        if (c < 0x80) {
          out.push(c);
        } else if (c < 0x800) {
          out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
        } else if (c >= 0xd800 && c <= 0xdbff) {
          // high surrogate; combine with the following low surrogate
          const next = str.charCodeAt(i + 1);
          c = 0x10000 + ((c & 0x3ff) << 10) + (next & 0x3ff);
          i++;
          out.push(
            0xf0 | (c >> 18),
            0x80 | ((c >> 12) & 0x3f),
            0x80 | ((c >> 6) & 0x3f),
            0x80 | (c & 0x3f),
          );
        } else {
          out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
        }
      }
      return new Uint8Array(out);
    }
  };
}

if (typeof g.TextDecoder === 'undefined') {
  g.TextDecoder = class TextDecoder {
    readonly encoding: string;
    constructor(encoding = 'utf-8', _options?: {fatal?: boolean; ignoreBOM?: boolean}) {
      this.encoding = encoding;
    }
    decode(input?: ArrayBuffer | ArrayBufferView): string {
      if (!input) {
        return '';
      }
      let bytes: Uint8Array;
      if (input instanceof Uint8Array) {
        bytes = input;
      } else if (ArrayBuffer.isView(input)) {
        bytes = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
      } else {
        bytes = new Uint8Array(input);
      }
      let out = '';
      let i = 0;
      const len = bytes.length;
      while (i < len) {
        const b0 = bytes[i++];
        if (b0 < 0x80) {
          out += String.fromCharCode(b0);
        } else if (b0 >= 0xc0 && b0 < 0xe0) {
          const b1 = bytes[i++] & 0x3f;
          out += String.fromCharCode(((b0 & 0x1f) << 6) | b1);
        } else if (b0 >= 0xe0 && b0 < 0xf0) {
          const b1 = bytes[i++] & 0x3f;
          const b2 = bytes[i++] & 0x3f;
          out += String.fromCharCode(((b0 & 0x0f) << 12) | (b1 << 6) | b2);
        } else {
          const b1 = bytes[i++] & 0x3f;
          const b2 = bytes[i++] & 0x3f;
          const b3 = bytes[i++] & 0x3f;
          let cp = ((b0 & 0x07) << 18) | (b1 << 12) | (b2 << 6) | b3;
          cp -= 0x10000;
          out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
        }
      }
      return out;
    }
  };
}

export {};
