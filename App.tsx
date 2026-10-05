/**
 * Desktop Remote — Android agent.
 *
 * This device is the controlled endpoint: once enrolled it connects to the
 * signalling gateway, shares its screen over WebRTC to an operator in the
 * Command Center, and accepts remote input via an AccessibilityService.
 *
 * Boot flow: load config + identity → if not enrolled, EnrollScreen; otherwise
 * build the AgentController, start it, and show the StatusScreen.
 */
import React, {useEffect, useMemo, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  StatusBar,
  StyleSheet,
  View,
} from 'react-native';
import {SafeAreaProvider, SafeAreaView} from 'react-native-safe-area-context';

import {T} from './src/ui/theme';
import {EnrollScreen} from './src/screens/EnrollScreen';
import {StatusScreen} from './src/screens/StatusScreen';
import {SettingsScreen} from './src/screens/SettingsScreen';
import {
  clearIdentity,
  loadConfig,
  loadIdentity,
  type AppConfig,
  type Identity,
} from './src/core/storage';
import {AGENT_VERSION, defaultHostname, osVersion} from './src/core/deviceInfo';
import {AgentController} from './src/agent/controller';
import {IosScreenPicker} from './src/webrtc/iosPicker';

// Module-level singleton so React dev double-mounts / re-renders never create a
// second controller (two signal connections fight over the same device: the
// gateway 4004s one, it reconnects, kicks the other — an infinite ping-pong).
let activeController: AgentController | null = null;
let activeKey = '';

type Route = 'boot' | 'enroll' | 'status' | 'settings';

function App(): React.JSX.Element {
  const [route, setRoute] = useState<Route>('boot');
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [identity, setIdentity] = useState<Identity | null>(null);
  const controllerRef = useRef<AgentController | null>(null);
  const [ctrlTick, setCtrlTick] = useState(0);

  // Load persisted state once.
  useEffect(() => {
    (async () => {
      const cfg = await loadConfig();
      const id = await loadIdentity();
      setConfig(cfg);
      setIdentity(id);
      setRoute(id ? 'status' : 'enroll');
    })();
  }, []);

  // Build and run the controller whenever we have an identity + config. The
  // controller is a module-level singleton keyed by device+config, so it is
  // created once and survives re-renders and React dev double-mounts (no second
  // signal connection). It is only torn down on unenroll or a settings change.
  useEffect(() => {
    if (!identity || !config || route === 'enroll' || route === 'boot') {
      return;
    }
    const key = `${identity.deviceId}|${config.apiBaseUrl}|${config.gatewayUrlOverride || ''}|${config.autoAcceptConsent}|${config.forceRelay}|${JSON.stringify(config.iceServers)}`;
    if (activeController && activeKey === key) {
      controllerRef.current = activeController;
      setCtrlTick(t => t + 1);
      return; // reuse the running singleton
    }
    if (activeController) {
      activeController.stop(); // config changed: replace it
      activeController = null;
    }
    const controller = new AgentController(
      config,
      identity,
      {
        hostname: defaultHostname(),
        lastUser: 'device-owner',
        osVersion: osVersion(),
        agentVersion: AGENT_VERSION,
      },
      config.autoAcceptConsent,
    );
    activeController = controller;
    activeKey = key;
    controllerRef.current = controller;
    controller.start();
    setCtrlTick(t => t + 1);
    // No cleanup that stops the controller: re-renders/double-mounts must not
    // kill the live connection. Teardown happens in onUnenroll / onSaveSettings.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity, config]);

  const onEnrolled = (id: Identity) => {
    setIdentity(id);
    setRoute('status');
  };

  const onUnenroll = () => {
    Alert.alert('Unenroll device', 'This removes the device identity from this phone. Continue?', [
      {text: 'Cancel', style: 'cancel'},
      {
        text: 'Unenroll',
        style: 'destructive',
        onPress: async () => {
          activeController?.stop();
          activeController = null;
          activeKey = '';
          controllerRef.current = null;
          await clearIdentity();
          setIdentity(null);
          setRoute('enroll');
        },
      },
    ]);
  };

  const onSaveSettings = (next: AppConfig) => {
    // Drop the running singleton so the effect rebuilds it with the new config.
    activeController?.stop();
    activeController = null;
    activeKey = '';
    controllerRef.current = null;
    setConfig(next);
  };

  const content = useMemo(() => {
    if (route === 'boot' || !config) {
      return (
        <View style={styles.center}>
          <ActivityIndicator color={T.accent} size="large" />
        </View>
      );
    }
    if (route === 'enroll' || !identity) {
      return (
        <EnrollScreen config={config} onConfigChange={setConfig} onEnrolled={onEnrolled} />
      );
    }
    if (route === 'settings') {
      return (
        <SettingsScreen config={config} onSave={onSaveSettings} onBack={() => setRoute('status')} />
      );
    }
    // status
    return controllerRef.current ? (
      <StatusScreen
        controller={controllerRef.current}
        onOpenSettings={() => setRoute('settings')}
        onUnenroll={onUnenroll}
      />
    ) : (
      <View style={styles.center}>
        <ActivityIndicator color={T.accent} size="large" />
      </View>
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route, config, identity, ctrlTick]);

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" />
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        {content}
        {/* Hidden iOS ReplayKit broadcast picker host (no-op on Android). */}
        <IosScreenPicker />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safe: {flex: 1, backgroundColor: T.bg},
  center: {flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: T.bg},
});

export default App;
