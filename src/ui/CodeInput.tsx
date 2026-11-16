/**
 * A 6-digit enrollment code entry — one hidden TextInput driving six visual
 * boxes (simplest robust way to get this right: no per-box focus management
 * to get wrong). Each digit pops in as it's typed, the next empty box shows
 * a blinking cursor, and a wrong code can be shaken via the ref.
 */
import React, {forwardRef, useEffect, useImperativeHandle, useRef} from 'react';
import {Animated, Easing, StyleSheet, Text, TextInput, TouchableWithoutFeedback, type TextInputInstance} from 'react-native';
import {T} from './theme';

const LENGTH = 6;

export type CodeInputHandle = {shake: () => void};

export const CodeInput = forwardRef<
  CodeInputHandle,
  {
    value: string;
    onChangeText: (v: string) => void;
    onComplete?: (v: string) => void;
    autoFocus?: boolean;
    editable?: boolean;
  }
>(function CodeInput({value, onChangeText, onComplete, autoFocus, editable = true}, ref) {
  const inputRef = useRef<TextInputInstance>(null);
  const shakeX = useRef(new Animated.Value(0)).current;
  const scales = useRef(Array.from({length: LENGTH}, () => new Animated.Value(1))).current;
  const prevLength = useRef(value.length);

  useImperativeHandle(ref, () => ({
    shake: () => {
      shakeX.setValue(0);
      Animated.sequence([
        Animated.timing(shakeX, {toValue: 1, duration: 55, easing: Easing.linear, useNativeDriver: true}),
        Animated.timing(shakeX, {toValue: -1, duration: 55, easing: Easing.linear, useNativeDriver: true}),
        Animated.timing(shakeX, {toValue: 1, duration: 55, easing: Easing.linear, useNativeDriver: true}),
        Animated.timing(shakeX, {toValue: -1, duration: 55, easing: Easing.linear, useNativeDriver: true}),
        Animated.timing(shakeX, {toValue: 0, duration: 55, easing: Easing.linear, useNativeDriver: true}),
      ]).start();
    },
  }));

  useEffect(() => {
    if (value.length > prevLength.current && value.length <= LENGTH) {
      const i = value.length - 1;
      scales[i].setValue(0.65);
      Animated.spring(scales[i], {toValue: 1, friction: 4.5, tension: 180, useNativeDriver: true}).start();
    }
    prevLength.current = value.length;
    if (value.length === LENGTH) {
      onComplete?.(value);
    }
    // scales is a stable ref array; only value should re-trigger this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const translateX = shakeX.interpolate({inputRange: [-1, 1], outputRange: [-9, 9]});

  return (
    <TouchableWithoutFeedback onPress={() => inputRef.current?.focus()}>
      <Animated.View style={[styles.row, {transform: [{translateX}]}]}>
        {Array.from({length: LENGTH}).map((_, i) => {
          const filled = i < value.length;
          const active = editable && i === value.length;
          return (
            <Animated.View
              key={i}
              style={[
                styles.box,
                filled && styles.boxFilled,
                active && styles.boxActive,
                {transform: [{scale: scales[i]}]},
              ]}>
              <Text style={styles.digit}>{value[i] || ''}</Text>
              {active ? <Cursor /> : null}
            </Animated.View>
          );
        })}
        <TextInput
          ref={inputRef}
          value={value}
          onChangeText={t => onChangeText(t.replace(/[^0-9]/g, '').slice(0, LENGTH))}
          keyboardType="number-pad"
          maxLength={LENGTH}
          autoFocus={autoFocus}
          editable={editable}
          caretHidden
          style={styles.hiddenInput}
        />
      </Animated.View>
    </TouchableWithoutFeedback>
  );
});

function Cursor() {
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {toValue: 0.15, duration: 500, easing: Easing.inOut(Easing.quad), useNativeDriver: true}),
        Animated.timing(opacity, {toValue: 1, duration: 500, easing: Easing.inOut(Easing.quad), useNativeDriver: true}),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return <Animated.View style={[styles.cursor, {opacity}]} />;
}

const styles = StyleSheet.create({
  row: {flexDirection: 'row', justifyContent: 'center', gap: 9},
  box: {
    width: 46,
    height: 56,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: T.border,
    backgroundColor: T.bgElev,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxFilled: {borderColor: T.accent + '99', backgroundColor: T.accentSoft},
  boxActive: {borderColor: T.accent},
  digit: {color: T.text, fontSize: 24, fontWeight: '800'},
  cursor: {position: 'absolute', width: 2, height: 24, backgroundColor: T.accent, borderRadius: 1},
  hiddenInput: {position: 'absolute', opacity: 0, width: '100%', height: '100%'},
});
