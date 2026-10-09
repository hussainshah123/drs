/**
 * Permissions tab — a single hub where the device owner grants everything the
 * agent needs: notifications, screen sharing, remote control (Android
 * accessibility) and device management. Each row shows live status and an
 * action to enable it. Also hosts Settings + Unenroll.
 */
import React, {useEffect, useState} from 'react';
import {
  Alert,
  AppState,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {T} from '../ui/theme';
import {ChatHeader} from '../chat/ui';
import {Icon, type IconName} from '../ui/Icon';
import {RemoteControl} from '../native/remoteControl';
import {DeviceManagement} from '../native/deviceManagement';
import {getPermissionState, requestStartupPermissions, type PermissionState} from '../core/permissions';
import type {AgentController, ControllerState} from '../agent/controller';

type RowSpec = {
  key: string;
  icon: IconName;
  title: string;
  desc: string;
  granted: boolean;
  warn?: boolean;
  statusText: string;
  action?: {label: string; onPress: () => void};
};

export function PermissionsScreen({
  controller,
  onOpenSettings,
  onUnenroll,
}: {
  controller: AgentController;
  onOpenSettings: () => void;
  onUnenroll: () => void;
}) {
  const [state, setState] = useState<ControllerState>(controller.getState());
  const [perms, setPerms] = useState<PermissionState | null>(null);

  const refreshPerms = async () => setPerms(await getPermissionState());

  useEffect(() => controller.subscribe(setState), [controller]);
  useEffect(() => {
    void refreshPerms();
    const sub = AppState.addEventListener('change', s => {
      if (s === 'active') {
        void controller.refreshAccessibility();
        void controller.refreshDeviceAdmin();
        void refreshPerms();
      }
    });
    return () => sub.remove();
  }, [controller]);

  const isAndroid = Platform.OS === 'android';
  const rows: RowSpec[] = [];

  // Notifications
  rows.push({
    key: 'notif',
    icon: 'bell',
    title: 'Notifications',
    desc: 'Show alerts and the screen-share status while a session is running.',
    granted: !!perms?.notifications,
    statusText: perms?.notifications ? 'Allowed' : 'Off',
    action: perms?.notifications
      ? undefined
      : {
          label: 'Allow',
          onPress: async () => {
            await requestStartupPermissions();
            await refreshPerms();
            if (!(await getPermissionState()).notifications) {
              Linking.openSettings();
            }
          },
        },
  });

  // Screen sharing
  rows.push({
    key: 'screen',
    icon: 'monitor',
    title: 'Screen sharing',
    desc:
      Platform.OS === 'ios'
        ? 'Start a ReplayKit broadcast so an operator can view this screen.'
        : 'Allow the operator to view this device screen (asks once).',
    granted: state.sharing || state.screenActive,
    statusText: state.sharing ? 'Active' : 'Ready',
    action: state.sharing
      ? {label: 'Stop', onPress: () => controller.stopSharing()}
      : {
          label: 'Start',
          onPress: async () => {
            const err = await controller.startSharing();
            if (err) {
              Alert.alert('Screen sharing failed', err);
            }
          },
        },
  });

  // Remote control
  if (perms?.remoteControlSupported) {
    rows.push({
      key: 'remote',
      icon: 'pointer',
      title: 'Remote control',
      desc: 'Let an operator tap, swipe and type on this device (Accessibility).',
      granted: !!perms?.remoteControl,
      statusText: perms?.remoteControl ? 'Enabled' : 'Disabled',
      action: perms?.remoteControl
        ? undefined
        : {label: 'Enable', onPress: () => RemoteControl.openAccessibilitySettings()},
    });
  } else {
    rows.push({
      key: 'remote',
      icon: 'pointer',
      title: 'Remote control',
      desc:
        Platform.OS === 'ios'
          ? 'Apple does not allow apps to control iOS. This device is view-only.'
          : 'Not available on this device.',
      granted: false,
      warn: true,
      statusText: Platform.OS === 'ios' ? 'View only' : 'N/A',
    });
  }

  // Device management (Android)
  if (isAndroid && DeviceManagement.available()) {
    rows.push({
      key: 'admin',
      icon: 'shield',
      title: 'Device management',
      desc: 'Allow an operator to remotely lock this device. Full wipe needs Device Owner.',
      granted: state.deviceOwner,
      warn: state.deviceAdminActive && !state.deviceOwner,
      statusText: state.deviceOwner ? 'Device owner' : state.deviceAdminActive ? 'Admin only' : 'Off',
      action: state.deviceAdminActive
        ? undefined
        : {label: 'Enable', onPress: () => controller.openDeviceAdminSettings()},
    });
  }

  const grantedCount = rows.filter(r => r.granted).length;

  return (
    <View style={styles.wrap}>
      <ChatHeader title="Permissions" subtitle={`${grantedCount}/${rows.length} enabled`} />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.sectionLabel}>ACCESS</Text>
        <View style={styles.card}>
          {rows.map((r, i) => (
            <PermRow key={r.key} spec={r} border={i > 0} />
          ))}
        </View>

        <Text style={styles.sectionLabel}>ACCOUNT</Text>
        <View style={styles.card}>
          <TouchableOpacity activeOpacity={0.6} style={styles.linkRow} onPress={onOpenSettings}>
            <View style={styles.linkIcon}>
              <Icon name="settings" size={18} color={T.text} />
            </View>
            <Text style={styles.linkText}>Settings</Text>
            <Icon name="chevron" size={18} color={T.textFaint} />
          </TouchableOpacity>
          <TouchableOpacity
            activeOpacity={0.6}
            style={[styles.linkRow, styles.linkBorder]}
            onPress={() => Linking.openSettings()}>
            <View style={styles.linkIcon}>
              <Icon name="smartphone" size={18} color={T.text} />
            </View>
            <Text style={styles.linkText}>Open system app settings</Text>
            <Icon name="chevron" size={18} color={T.textFaint} />
          </TouchableOpacity>
          <TouchableOpacity
            activeOpacity={0.6}
            style={[styles.linkRow, styles.linkBorder]}
            onPress={onUnenroll}>
            <View style={styles.linkIcon}>
              <Icon name="logout" size={18} color={T.bad} />
            </View>
            <Text style={[styles.linkText, {color: T.bad}]}>Unenroll this device</Text>
            <Icon name="chevron" size={18} color={T.textFaint} />
          </TouchableOpacity>
        </View>
        <View style={{height: 24}} />
      </ScrollView>
    </View>
  );
}

function PermRow({spec, border}: {spec: RowSpec; border: boolean}) {
  const color = spec.granted ? T.good : spec.warn ? T.warn : T.textFaint;
  return (
    <View style={[styles.permRow, border && styles.permBorder]}>
      <View style={styles.permIcon}>
        <Icon name={spec.icon} size={20} color={T.accent} />
      </View>
      <View style={styles.permBody}>
        <Text style={styles.permTitle}>{spec.title}</Text>
        <Text style={styles.permDesc}>{spec.desc}</Text>
        <View style={styles.permStatusRow}>
          <View style={[styles.statusDot, {backgroundColor: color}]} />
          <Text style={[styles.permStatus, {color}]}>{spec.statusText}</Text>
        </View>
      </View>
      {spec.action ? (
        <TouchableOpacity activeOpacity={0.85} style={styles.allowBtn} onPress={spec.action.onPress}>
          <Text style={styles.allowText}>{spec.action.label}</Text>
        </TouchableOpacity>
      ) : spec.granted ? (
        <View style={styles.okBadge}>
          <Icon name="check" size={15} color={T.good} strokeWidth={3} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {flex: 1, backgroundColor: T.bg},
  content: {padding: 16},
  sectionLabel: {
    color: T.textFaint,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
    marginBottom: 10,
    marginTop: 8,
  },
  card: {
    backgroundColor: T.card,
    borderRadius: T.radius,
    borderWidth: 1,
    borderColor: T.border,
    paddingHorizontal: 14,
    marginBottom: 8,
  },
  permRow: {flexDirection: 'row', alignItems: 'center', paddingVertical: 14},
  permBorder: {borderTopWidth: 1, borderTopColor: T.borderSoft},
  permIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: T.accentSoft,
    borderWidth: 1,
    borderColor: 'rgba(255,122,26,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 13,
  },
  permBody: {flex: 1, marginRight: 10},
  permTitle: {color: T.text, fontSize: 15.5, fontWeight: '800'},
  permDesc: {color: T.textDim, fontSize: 12.5, marginTop: 3, lineHeight: 17},
  permStatusRow: {flexDirection: 'row', alignItems: 'center', marginTop: 7},
  statusDot: {width: 7, height: 7, borderRadius: 4, marginRight: 6},
  permStatus: {fontSize: 12, fontWeight: '700'},
  allowBtn: {
    backgroundColor: T.accent,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 9,
  },
  allowText: {color: '#1A0E00', fontSize: 13.5, fontWeight: '800'},
  okBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: T.goodSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  linkRow: {flexDirection: 'row', alignItems: 'center', paddingVertical: 15},
  linkBorder: {borderTopWidth: 1, borderTopColor: T.borderSoft},
  linkIcon: {width: 30},
  linkText: {flex: 1, color: T.text, fontSize: 15, fontWeight: '700'},
});
