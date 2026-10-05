/**
 * Settings: backend URL, ICE servers (STUN/TURN), relay-only toggle and the
 * auto-accept-consent policy. Saved to AsyncStorage; takes effect on next
 * agent restart.
 */
import React, {useState} from 'react';
import {Alert, ScrollView, StyleSheet, Switch, Text, View} from 'react-native';
import {Button, Card, Field, H1, H2, P, Row} from '../ui/components';
import {T} from '../ui/theme';
import {saveConfig, type AppConfig} from '../core/storage';

export function SettingsScreen({
  config,
  onSave,
  onBack,
}: {
  config: AppConfig;
  onSave: (c: AppConfig) => void;
  onBack: () => void;
}) {
  const [apiUrl, setApiUrl] = useState(config.apiBaseUrl);
  const [gateway, setGateway] = useState(config.gatewayUrlOverride || '');
  const [iceText, setIceText] = useState(JSON.stringify(config.iceServers, null, 2));
  const [relay, setRelay] = useState(config.forceRelay);
  const [auto, setAuto] = useState(config.autoAcceptConsent);

  const save = async () => {
    let iceServers = config.iceServers;
    try {
      iceServers = JSON.parse(iceText);
      if (!Array.isArray(iceServers)) {
        throw new Error('ICE servers must be a JSON array');
      }
    } catch (e: any) {
      Alert.alert('Invalid ICE servers', e?.message || 'Expected a JSON array');
      return;
    }
    const next: AppConfig = {
      ...config,
      apiBaseUrl: apiUrl.trim(),
      gatewayUrlOverride: gateway.trim() || undefined,
      iceServers,
      forceRelay: relay,
      autoAcceptConsent: auto,
    };
    await saveConfig(next);
    onSave(next);
    onBack();
  };

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      <H1>Settings</H1>

      <Card>
        <H2>Backend</H2>
        <Field label="API BASE URL" value={apiUrl} onChangeText={setApiUrl} />
        <Field
          label="GATEWAY URL (optional override)"
          value={gateway}
          onChangeText={setGateway}
          placeholder="ws://10.0.2.2:8081/ws"
        />
        <P dim>Leave the gateway blank to use the URL the API returns.</P>
      </Card>

      <Card>
        <H2>WebRTC</H2>
        <Field
          label="ICE SERVERS (JSON)"
          value={iceText}
          onChangeText={setIceText}
          multiline
        />
        <Row>
          <Text style={styles.switchLabel}>Force relay (TURN only)</Text>
          <Switch value={relay} onValueChange={setRelay} />
        </Row>
      </Card>

      <Card>
        <H2>Session policy</H2>
        <Row>
          <View style={{flex: 1, paddingRight: 12}}>
            <Text style={styles.switchLabel}>Auto-accept remote sessions</Text>
            <P dim>Unattended devices answer without prompting the end user.</P>
          </View>
          <Switch value={auto} onValueChange={setAuto} />
        </Row>
      </Card>

      <Button title="Save" onPress={save} />
      <Button title="Back" kind="ghost" onPress={onBack} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {flex: 1, backgroundColor: T.bg},
  content: {padding: T.space, paddingBottom: 48},
  switchLabel: {color: T.text, fontSize: 14, fontWeight: '600'},
});
