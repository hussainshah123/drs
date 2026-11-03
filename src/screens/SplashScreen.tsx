/**
 * Animated boot splash — the app's orange/black brand (central "device" node
 * orbited by a smaller "operator" node — "every device, one point of
 * control"). Shown from the moment the AndroidX native splash hands off (same
 * background color, so the transition is invisible) until config/identity
 * finish loading in App.tsx.
 */
import React, {useEffect, useRef} from 'react';
import {Animated, Easing, StyleSheet, Text, View} from 'react-native';
import {T} from '../ui/theme';

export function SplashScreen(): React.JSX.Element {
  const intro = useRef(new Animated.Value(0)).current;
  const wordmark = useRef(new Animated.Value(0)).current;
  const tagline = useRef(new Animated.Value(0)).current;
  const orbit = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.timing(intro, {
        toValue: 1,
        duration: 480,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.stagger(130, [
        Animated.timing(wordmark, {toValue: 1, duration: 360, useNativeDriver: true}),
        Animated.timing(tagline, {toValue: 1, duration: 360, useNativeDriver: true}),
      ]),
    ]).start();

    // Idle orbit loop — keeps the mark alive for however long boot actually
    // takes, instead of a one-shot animation that could finish (and look
    // frozen) before config/identity are ready.
    Animated.loop(
      Animated.timing(orbit, {
        toValue: 1,
        duration: 3200,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    ).start();
  }, [intro, wordmark, tagline, orbit]);

  const spin = orbit.interpolate({inputRange: [0, 1], outputRange: ['0deg', '360deg']});

  return (
    <View style={styles.wrap}>
      <Animated.View
        style={[
          styles.mark,
          {opacity: intro, transform: [{scale: intro.interpolate({inputRange: [0, 1], outputRange: [0.8, 1]})}]},
        ]}>
        <View style={styles.ring} />
        <View style={styles.node} />
        <Animated.View style={[styles.satelliteOrbit, {transform: [{rotate: spin}]}]}>
          <View style={styles.satellite} />
        </Animated.View>
      </Animated.View>

      <Animated.Text
        style={[
          styles.wordmark,
          {
            opacity: wordmark,
            transform: [{translateY: wordmark.interpolate({inputRange: [0, 1], outputRange: [10, 0]})}],
          },
        ]}>
        DRS
      </Animated.Text>

      <Animated.Text
        style={[
          styles.tagline,
          {
            opacity: tagline,
            transform: [{translateY: tagline.interpolate({inputRange: [0, 1], outputRange: [8, 0]})}],
          },
        ]}>
        Every Device. One Point of Control.
      </Animated.Text>
    </View>
  );
}

const MARK_SIZE = 108;
const RING_SIZE = 84;
const NODE_SIZE = 34;
const SATELLITE_SIZE = 16;

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: T.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mark: {
    width: MARK_SIZE,
    height: MARK_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 28,
  },
  ring: {
    position: 'absolute',
    width: RING_SIZE,
    height: RING_SIZE,
    borderRadius: RING_SIZE / 2,
    borderWidth: 2,
    borderColor: T.accent,
  },
  node: {
    width: NODE_SIZE,
    height: NODE_SIZE,
    borderRadius: NODE_SIZE / 2,
    backgroundColor: T.accent,
  },
  satelliteOrbit: {
    position: 'absolute',
    width: MARK_SIZE,
    height: MARK_SIZE,
    alignItems: 'center',
  },
  satellite: {
    width: SATELLITE_SIZE,
    height: SATELLITE_SIZE,
    borderRadius: SATELLITE_SIZE / 2,
    backgroundColor: T.violet,
  },
  wordmark: {
    color: T.text,
    fontSize: 34,
    fontWeight: '800',
    letterSpacing: 6,
  },
  tagline: {
    color: T.textDim,
    fontSize: 13.5,
    marginTop: 8,
    letterSpacing: 0.2,
  },
});
