import {bodyKey, decodeSession, encodeSession} from '../src/proto/session';

describe('session control protocol', () => {
  it('round-trips the device lock control', () => {
    const bytes = encodeSession({
      seq: 1,
      control: {lock_workstation: true},
    });
    const decoded = decodeSession(bytes);

    expect(bodyKey(decoded)).toBe('control');
    expect(decoded.control.lock_workstation).toBe(true);
  });

  it.each([true, false])('round-trips lock_local_input=%s', locked => {
    const bytes = encodeSession({
      seq: 1,
      control: {lock_local_input: locked},
    });
    const decoded = decodeSession(bytes);

    expect(bodyKey(decoded)).toBe('control');
    expect(decoded.control.lock_local_input).toBe(locked);
  });
});
