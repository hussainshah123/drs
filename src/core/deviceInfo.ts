/**
 * Lightweight device facts for enrollment and the agent's AgentState, derived
 * from React Native's Platform (no extra native dependency). A stable device
 * UUID is generated once and persisted with the identity.
 */
import {Platform} from 'react-native';

export function osVersion(): string {
  return Platform.OS === 'ios'
    ? `iOS ${Platform.Version}`
    : `Android ${Platform.Version}`;
}

export function defaultHostname(): string {
  const v = Platform.constants as any;
  const model =
    Platform.OS === 'ios'
      ? v?.systemName || 'ios-device'
      : v?.Model || v?.Brand || 'android-device';
  return String(model).replace(/\s+/g, '-');
}

export const AGENT_VERSION = '0.1.0';
