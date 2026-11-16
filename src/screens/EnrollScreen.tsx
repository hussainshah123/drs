/**
 * Enrollment screen. The admin creates an enrollment token in the portal
 * (POST /v1/enrollment-tokens) and the device is enrolled here. The API base
 * URL is editable so the same build points at any backend.
 */
import React, {useEffect, useRef, useState} from 'react';
import {Alert, Animated, Easing, Platform, ScrollView, StyleSheet, Text, View} from 'react-native';
import {Button, Card, H1, Label, Logo, P} from '../ui/components';
import {CodeInput, type CodeInputHandle} from '../ui/CodeInput';
import {T} from '../ui/theme';
import {enrollDevice} from '../core/enroll';
import {
  DEFAULT_ENROLLMENT_TOKEN,
  saveConfig,
  type AppConfig,
  type Identity,
} from '../core/storage';

export function EnrollScreen({
  config,
  onConfigChange,
  onEnrolled,
}: {
  config: AppConfig;
  onConfigChange: (c: AppConfig) => void;
  onEnrolled: (id: Identity) => void;
}) {
  const [apiUrl] = useState(config.apiBaseUrl);
  // The device owner types the 6-digit code shown in the Command Center
  // portal here. Android also ships with a pre-provisioned long-form token
  // for silent auto-enrollment (below) — unrelated to what's typed on screen.
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const codeInputRef = useRef<CodeInputHandle>(null);
  const cardAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(cardAnim, {
      toValue: 1,
      duration: 480,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [cardAnim]);

  const enroll = async (tok: string) => {
    if (!tok.trim()) {
      Alert.alert('Enrollment code required', 'Enter the 6-digit code shown in the Command Center.');
      return;
    }
    setBusy(true);
    try {
      const next: AppConfig = {...config, apiBaseUrl: apiUrl.trim()};
      await saveConfig(next);
      onConfigChange(next);
      const id = await enrollDevice(next, tok.trim());
      onEnrolled(id);
    } catch (e: any) {
      Alert.alert('Enrollment failed', e?.message || String(e));
      setCode('');
      codeInputRef.current?.shake();
    } finally {
      setBusy(false);
    }
  };

  // One-shot auto-enroll on Android when a token is baked in: the device comes
  // online by itself on first launch, no user interaction needed.
  const autoEnrolled = useRef(false);
  useEffect(() => {
    if (autoEnrolled.current) {
      return;
    }
    if (Platform.OS === 'android' && DEFAULT_ENROLLMENT_TOKEN) {
      autoEnrolled.current = true;
      enroll(DEFAULT_ENROLLMENT_TOKEN);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      <View style={styles.hero}>
        <Logo size={58} />
        <H1>Desktop Remote</H1>
        <P dim>Enroll this device so it can be securely viewed and controlled from the Command Center.</P>
      </View>

      {/* <Card>
        <Label>Backend</Label>
        <Field
          label="API BASE URL"
          value={apiUrl}
          onChangeText={setApiUrl}
          placeholder="http://10.0.2.2:8080"
        />
        <Text style={styles.hint}>Use 10.0.2.2 for the host machine from an Android emulator.</Text>
      </Card> */}

      <Animated.View
        style={{
          opacity: cardAnim,
          transform: [{translateY: cardAnim.interpolate({inputRange: [0, 1], outputRange: [18, 0]})}],
        }}>
        <Card style={styles.codeCard}>
          <Label>Enrollment code</Label>
          <P dim>Enter the 6-digit code shown for this device in the Command Center.</P>
          <View style={styles.codeWrap}>
            <CodeInput
              ref={codeInputRef}
              value={code}
              onChangeText={setCode}
              onComplete={v => enroll(v)}
              autoFocus={Platform.OS === 'ios'}
              editable={!busy}
            />
          </View>
          <Button
            title={busy ? 'Enrolling…' : 'Enroll device'}
            onPress={() => enroll(code)}
            loading={busy}
            disabled={code.length < 6}
          />
        </Card>
      </Animated.View>

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
  codeCard: {alignItems: 'stretch'},
  codeWrap: {marginTop: 18, marginBottom: 6},
});
