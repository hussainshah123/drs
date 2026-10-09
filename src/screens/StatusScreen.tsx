/**
 * Status screen — the agent's operational console. A connection hero, a
 * readiness checklist (gateway, screen capture, permissions, remote control),
 * live participants, the consent prompt, and a running activity log.
 */
import React, {useEffect, useState} from 'react';
import {
  Alert,
  AppState,
  Linking,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {Avatar, Button, Card, H2, Label, Logo, P, Pill, Row, StatusRow} from '../ui/components';
import {T} from '../ui/theme';
import {RemoteControl} from '../native/remoteControl';
import {DeviceManagement} from '../native/deviceManagement';
import {getPermissionState, requestStartupPermissions, type PermissionState} from '../core/permissions';
import {recentLogs, subscribeLogs, type LogEntry} from '../core/log';
import type {AgentController, ControllerState} from '../agent/controller';

const STATUS_META: Record<string, {color: string; soft: string; label: string; hint: string}> = {
  idle: {color: T.textFaint, soft: '', label: 'Idle', hint: 'Starting up…'},
  connecting: {color: T.warn, soft: T.warnSoft, label: 'Connecting', hint: 'Reaching the gateway…'},
  reconnecting: {color: T.warn, soft: T.warnSoft, label: 'Reconnecting', hint: 'Lost the link — retrying…'},
  registered: {color: T.good, soft: T.goodSoft, label: 'Online', hint: 'Ready to be viewed and controlled.'},
  fatal: {color: T.bad, soft: T.badSoft, label: 'Rejected', hint: 'The gateway refused this device.'},
  closed: {color: T.textFaint, soft: '', label: 'Offline', hint: 'Not connected.'},
};

export function StatusScreen({controller}: {controller: AgentController}) {
  const [state, setState] = useState<ControllerState>(controller.getState());
  const [logs, setLogs] = useState<LogEntry[]>(recentLogs().slice(-40).reverse());
  const [perms, setPerms] = useState<PermissionState | null>(null);
  const [testing, setTesting] = useState(false);

  const refreshPerms = async () => setPerms(await getPermissionState());

  useEffect(() => controller.subscribe(setState), [controller]);
  useEffect(() => subscribeLogs(() => setLogs(recentLogs().slice(-40).reverse())), []);

  useEffect(() => {
    (async () => {
      await requestStartupPermissions();
      await refreshPerms();
    })();
    const sub = AppState.addEventListener('change', s => {
      if (s === 'active') {
        void controller.refreshAccessibility();
        void controller.refreshDeviceAdmin();
        void refreshPerms();
      }
    });
    return () => sub.remove();
  }, [controller]);

  const meta = STATUS_META[state.signal] || STATUS_META.idle;

  return (
    <View style={styles.wrap}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        {/* Header */}
        <Row style={{marginBottom: 20}}>
          <Row style={{justifyContent: 'flex-start'}}>
            <Logo size={40} />
            <View style={{marginLeft: 12}}>
              <Text style={styles.brand}>Desktop Remote</Text>
              <Text style={styles.brandSub}>Device agent</Text>
            </View>
          </Row>
          <Pill text={meta.label.toUpperCase()} color={meta.color} soft={meta.soft || undefined} />
        </Row>

        {/* Connection hero */}
        <Card style={[styles.hero, {borderColor: meta.color + '44'}]}>
          <View style={[styles.heroGlow, {backgroundColor: meta.color}]} />
          <Text style={styles.heroStatus}>{meta.label}</Text>
          <Text style={styles.heroHint}>{meta.hint}</Text>
          <View style={styles.heroMetaRow}>
            <HeroMeta label="DEVICE" value={short(state.deviceId)} />
            <HeroMeta label="VIEWERS" value={String(state.participants.filter(p => p.connected).length)} />
            <HeroMeta label="SCREEN" value={state.screenActive ? 'LIVE' : 'OFF'} color={state.screenActive ? T.good : undefined} />
          </View>
        </Card>

        {/* Readiness */}
        <Card>
          <Label>Readiness</Label>
          <StatusRow label="Gateway connection" ok={state.signal === 'registered'} warn={state.signal === 'connecting' || state.signal === 'reconnecting'} value={meta.label} />
          <StatusRow label="Screen sharing" ok={state.screenActive} value={state.screenActive ? 'active' : 'ready'} />
          <StatusRow label="Notifications" ok={!!perms?.notifications} value={perms?.notifications ? 'granted' : 'off'} />
          {perms?.remoteControlSupported ? (
            <StatusRow label="Remote control" ok={!!perms?.remoteControl} value={perms?.remoteControl ? 'enabled' : 'disabled'} />
          ) : (
            <StatusRow label="Remote control" ok={false} warn value={Platform.OS === 'ios' ? 'view-only (iOS)' : 'n/a'} />
          )}

          {perms && !perms.remoteControl && perms.remoteControlSupported && (
            <View style={{marginTop: 12}}>
              <P dim>Turn on the Desktop Remote accessibility service so an operator can tap, swipe and type on this device.</P>
              <Button title="Enable remote control" kind="soft" onPress={() => RemoteControl.openAccessibilitySettings()} />
            </View>
          )}
          {perms && !perms.notifications && (
            <Button title="Open notification settings" kind="ghost" small onPress={() => Linking.openSettings()} />
          )}
          {Platform.OS === 'android' && DeviceManagement.available() && (
            <>
              <StatusRow
                label="Device management"
                ok={state.deviceOwner}
                warn={state.deviceAdminActive && !state.deviceOwner}
                value={
                  state.deviceOwner
                    ? 'device owner'
                    : state.deviceAdminActive
                    ? 'admin only'
                    : 'off'
                }
              />
              {!state.deviceAdminActive && (
                <View style={{marginTop: 8}}>
                  <P dim>
                    Enable device admin so an operator can remotely lock this
                    company device. Reboot and wipe need full Device Owner, set up
                    during enterprise enrollment.
                  </P>
                  <Button
                    title="Enable device admin"
                    kind="soft"
                    onPress={async () => {
                      await controller.openDeviceAdminSettings();
                    }}
                  />
                </View>
              )}
            </>
          )}
          {Platform.OS === 'ios' && (
            <P dim>
              On iOS this device can be viewed live on the desktop. Apple does not
              allow apps to control iOS remotely, so input is disabled there.
            </P>
          )}
          <View style={{marginTop: 10}}>
            <P dim>
              {state.sharing
                ? 'Screen sharing is ON. Operators can view this device now — you can switch apps; capture keeps running.'
                : 'Tap below once (with this app open) and approve “Start now”. Sharing then stays on in the background, so operators can connect anytime without a new prompt.'}
            </P>
            <Button
              title={
                testing
                  ? 'Requesting…'
                  : state.sharing
                  ? 'Stop screen sharing'
                  : 'Start screen sharing'
              }
              kind={state.sharing ? 'danger' : 'primary'}
              onPress={async () => {
                if (state.sharing) {
                  controller.stopSharing();
                  return;
                }
                setTesting(true);
                const err = await controller.startSharing();
                setTesting(false);
                if (err) {
                  Alert.alert('Screen sharing failed', err);
                }
              }}
            />
          </View>
        </Card>

        {/* Participants */}
        <Card>
          <Row style={{marginBottom: state.participants.length ? 12 : 0}}>
            <Label>Connected operators</Label>
          </Row>
          {state.participants.length === 0 ? (
            <P dim>No one is connected. Start a session from the Command Center to view or control this device.</P>
          ) : (
            state.participants.map(p => (
              <Row key={p.participantId} style={styles.participant}>
                <Row style={{justifyContent: 'flex-start', flex: 1}}>
                  <Avatar name={p.name} color={p.connected ? T.good : T.warn} />
                  <View style={{marginLeft: 12, flex: 1}}>
                    <Text style={styles.pName}>{p.name}</Text>
                    <Text style={styles.pMeta}>
                      {p.connected ? 'connected' : 'joining'} · {p.controlAllowed ? 'can control' : 'view only'}
                    </Text>
                  </View>
                </Row>
                <Pill text={p.connected ? 'LIVE' : 'WAIT'} color={p.connected ? T.good : T.warn} soft={p.connected ? T.goodSoft : T.warnSoft} />
              </Row>
            ))
          )}
        </Card>

        {/* Activity */}
        <Card>
          <Label>Activity</Label>
          <View style={styles.logBox}>
            {logs.length === 0 ? (
              <Text style={styles.logDim}>No activity yet.</Text>
            ) : (
              logs.map((l, i) => (
                <Text key={i} style={[styles.logLine, levelStyle(l.level)]} numberOfLines={2}>
                  <Text style={styles.logTime}>{time(l.ts)} </Text>
                  <Text style={styles.logTag}>{l.tag}  </Text>
                  {l.msg}
                </Text>
              ))
            )}
          </View>
        </Card>

        <View style={{height: 20}} />
      </ScrollView>

      <ConsentModal controller={controller} state={state} />
    </View>
  );
}

function HeroMeta({label, value, color}: {label: string; value: string; color?: string}) {
  return (
    <View style={{flex: 1}}>
      <Text style={styles.heroMetaLabel}>{label}</Text>
      <Text style={[styles.heroMetaValue, color ? {color} : null]}>{value}</Text>
    </View>
  );
}

function ConsentModal({controller, state}: {controller: AgentController; state: ControllerState}) {
  const c = state.pendingConsent;
  return (
    <Modal visible={!!c} transparent animationType="fade">
      <View style={styles.modalBg}>
        <Card style={{width: '100%'}}>
          <Row style={{justifyContent: 'flex-start', marginBottom: 14}}>
            {c && <Avatar name={c.participantName} />}
            <View style={{marginLeft: 12, flex: 1}}>
              <H2>Allow remote session?</H2>
            </View>
          </Row>
          {c && (
            <>
              <P>
                <Text style={{fontWeight: '800'}}>{c.participantName}</Text>
                {c.tenantName ? ` from ${c.tenantName}` : ''} wants to connect to this
                device and may view the screen{c.requestedPermissions & 2 ? ' and control it' : ''}.
              </P>
              <View style={{height: 16}} />
              <Button title="Allow" onPress={() => controller.respondConsent(true)} />
              <Button title="Deny" kind="ghost" onPress={() => controller.respondConsent(false)} />
            </>
          )}
        </Card>
      </View>
    </Modal>
  );
}

function levelStyle(level: string) {
  if (level === 'error') {
    return {color: T.bad};
  }
  if (level === 'warn') {
    return {color: T.warn};
  }
  return {color: T.textDim};
}

const short = (s: string) => (s ? s.slice(0, 8) : '—');
const time = (ts: number) => {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};
const pad = (n: number) => String(n).padStart(2, '0');

const styles = StyleSheet.create({
  wrap: {flex: 1, backgroundColor: T.bg},
  scroll: {flex: 1},
  content: {padding: T.space, paddingBottom: 40},
  brand: {color: T.text, fontSize: 17, fontWeight: '800', letterSpacing: -0.3},
  brandSub: {color: T.textFaint, fontSize: 12, fontWeight: '600'},
  hero: {padding: 22, overflow: 'hidden'},
  heroGlow: {
    position: 'absolute',
    top: -60,
    right: -40,
    width: 160,
    height: 160,
    borderRadius: 80,
    opacity: 0.12,
  },
  heroStatus: {color: T.text, fontSize: 30, fontWeight: '900', letterSpacing: -0.8},
  heroHint: {color: T.textDim, fontSize: 14, marginTop: 4, lineHeight: 20},
  heroMetaRow: {flexDirection: 'row', marginTop: 20, gap: 8},
  heroMetaLabel: {color: T.textFaint, fontSize: 10, fontWeight: '800', letterSpacing: 1},
  heroMetaValue: {color: T.text, fontSize: 16, fontWeight: '800', marginTop: 3},
  participant: {paddingVertical: 10, borderTopWidth: 1, borderTopColor: T.borderSoft},
  pName: {color: T.text, fontSize: 15, fontWeight: '700'},
  pMeta: {color: T.textDim, fontSize: 12, marginTop: 2},
  logBox: {backgroundColor: T.bg, borderRadius: 12, padding: 12, minHeight: 90, borderWidth: 1, borderColor: T.borderSoft},
  logLine: {fontSize: 11, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', marginBottom: 3, lineHeight: 15},
  logTime: {color: T.textFaint},
  logTag: {color: T.accent, fontWeight: '700'},
  logDim: {color: T.textFaint, fontSize: 12},
  modalBg: {flex: 1, backgroundColor: 'rgba(0,0,0,0.78)', justifyContent: 'center', padding: 24},
});
