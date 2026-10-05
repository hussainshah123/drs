/**
 * Enrollment screen. The admin creates an enrollment token in the portal
 * (POST /v1/enrollment-tokens) and the device is enrolled here. The API base
 * URL is editable so the same build points at any backend.
 */
import React, {useState} from 'react';
import {Alert, ScrollView, StyleSheet, Text, View} from 'react-native';
import {Button, Card, Field, H1, Label, Logo, P} from '../ui/components';
import {T} from '../ui/theme';
import {enrollDevice} from '../core/enroll';
import {saveConfig, type AppConfig, type Identity} from '../core/storage';

export function EnrollScreen({
  config,
  onConfigChange,
  onEnrolled,
}: {
  config: AppConfig;
  onConfigChange: (c: AppConfig) => void;
  onEnrolled: (id: Identity) => void;
}) {
  const [apiUrl, setApiUrl] = useState(config.apiBaseUrl);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);

  const enroll = async () => {
    if (!token.trim()) {
      Alert.alert('Enrollment token required', 'Paste the token from the portal.');
      return;
    }
    setBusy(true);
    try {
      const next: AppConfig = {...config, apiBaseUrl: apiUrl.trim()};
      await saveConfig(next);
      onConfigChange(next);
      const id = await enrollDevice(next, token.trim());
      onEnrolled(id);
    } catch (e: any) {
      Alert.alert('Enrollment failed', e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      <View style={styles.hero}>
        <Logo size={58} />
        <H1>Desktop Remote</H1>
        <P dim>Enroll this device so it can be securely viewed and controlled from the Command Center.</P>
      </View>

      <Card>
        <Label>Backend</Label>
        <Field
          label="API BASE URL"
          value={apiUrl}
          onChangeText={setApiUrl}
          placeholder="http://10.0.2.2:8080"
        />
        <Text style={styles.hint}>Use 10.0.2.2 for the host machine from an Android emulator.</Text>
      </Card>

      <Card>
        <Label>Enrollment token</Label>
        <Field
          label="TOKEN"
          value={token}
          onChangeText={setToken}
          placeholder="paste the token from the portal"
          multiline
        />
        <Button title="Enroll device" onPress={enroll} loading={busy} />
      </Card>

      <P dim>
        A fresh Ed25519 identity is generated on this device. The private key never
        leaves the keystore; only the public key is registered.
      </P>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {flex: 1, backgroundColor: T.bg},
  content: {padding: T.space, paddingBottom: 48},
  hero: {alignItems: 'center', marginTop: 24, marginBottom: 24, gap: 10},
  hint: {color: T.textDim, fontSize: 13, lineHeight: 19},
});
