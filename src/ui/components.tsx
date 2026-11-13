/** Reusable UI atoms for the agent app. Dependency-free (glyphs, no icon font). */
import React, {useEffect, useRef} from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import {Icon, type IconName} from './Icon';
import {T, initials} from './theme';

export function Card({
  children,
  style,
  padded = true,
  glow,
  translucent,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  padded?: boolean;
  /** Soft accent-colored shadow for a card that should stand out (the hero). */
  glow?: boolean;
  /** Lets the app-wide starfield (ConnectionGlobe, in MainTabs) show faintly through the card instead of a fully opaque surface — use where that background would otherwise be hidden entirely behind stacked cards (the Home screen). */
  translucent?: boolean;
}) {
  return (
    <View
      style={[
        styles.card,
        glow && styles.cardGlow,
        // Must come after cardGlow: Android's `elevation` shadow is drawn
        // assuming an opaque surface, and combined with a translucent
        // background it paints a hard rectangular seam around the card
        // instead of a soft shadow — zeroing elevation here (while keeping
        // the iOS shadow* props, which don't have this bug) avoids it.
        translucent && styles.cardTranslucent,
        padded && {padding: T.space},
        style,
      ]}>
      {children}
    </View>
  );
}


export function H1({children}: {children: React.ReactNode}) {
  return <Text style={styles.h1}>{children}</Text>;
}

export function H2({children}: {children: React.ReactNode}) {
  return <Text style={styles.h2}>{children}</Text>;
}

export function Label({children}: {children: React.ReactNode}) {
  return <Text style={styles.sectionLabel}>{children}</Text>;
}

export function P({children, dim}: {children: React.ReactNode; dim?: boolean}) {
  return <Text style={[styles.p, dim && {color: T.textDim}]}>{children}</Text>;
}

export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  autoCapitalize = 'none',
  multiline,
  secureTextEntry,
}: {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  placeholder?: string;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  multiline?: boolean;
  secureTextEntry?: boolean;
}) {
  return (
    <View style={{marginBottom: 14}}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={[styles.input, multiline && {height: 92, textAlignVertical: 'top'}]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={T.textFaint}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        multiline={multiline}
        secureTextEntry={secureTextEntry}
      />
    </View>
  );
}

export function Button({
  title,
  onPress,
  kind = 'primary',
  loading,
  disabled,
  small,
}: {
  title: string;
  onPress: () => void;
  kind?: 'primary' | 'ghost' | 'danger' | 'soft';
  loading?: boolean;
  disabled?: boolean;
  small?: boolean;
}) {
  const map = {
    primary: {bg: T.accent, border: T.accent, fg: '#fff'},
    danger: {bg: 'transparent', border: T.bad, fg: T.bad},
    ghost: {bg: 'transparent', border: T.border, fg: T.text},
    soft: {bg: T.accentSoft, border: 'transparent', fg: T.accent},
  }[kind];
  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={onPress}
      disabled={disabled || loading}
      style={[
        styles.btn,
        kind === 'primary' && styles.btnGlow,
        small && {paddingVertical: 9, borderRadius: 10},
        {backgroundColor: map.bg, borderColor: map.border, opacity: disabled ? 0.45 : 1},
      ]}>
      {loading ? (
        <ActivityIndicator color={map.fg} />
      ) : (
        <Text style={[styles.btnText, {color: map.fg}, small && {fontSize: 13}]}>{title}</Text>
      )}
    </TouchableOpacity>
  );
}

export function Pill({
  text,
  color,
  soft,
  pulse,
}: {
  text: string;
  color: string;
  soft?: string;
  /** Animates the leading dot with a soft outward pulse — a live/active cue. */
  pulse?: boolean;
}) {
  return (
    <View style={[styles.pill, {borderColor: soft ? 'transparent' : color, backgroundColor: soft || 'transparent'}]}>
      <PulseDot color={color} active={!!pulse} />
      <Text style={[styles.pillText, {color}]}>{text}</Text>
    </View>
  );
}

/** A status dot that, when active, grows a fading ring outward on a loop. */
function PulseDot({color, active}: {color: string; active: boolean}) {
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!active) {
      anim.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.timing(anim, {
        toValue: 1,
        duration: 1600,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [active, anim]);

  const scale = anim.interpolate({inputRange: [0, 1], outputRange: [1, 2.4]});
  const opacity = anim.interpolate({inputRange: [0, 1], outputRange: [0.55, 0]});

  return (
    <View style={styles.pulseWrap}>
      {active && (
        <Animated.View
          style={[styles.pulseRing, {borderColor: color, opacity, transform: [{scale}]}]}
        />
      )}
      <View style={[styles.dot, {backgroundColor: color}]} />
    </View>
  );
}

export function Row({children, style}: {children: React.ReactNode; style?: StyleProp<ViewStyle>}) {
  return <View style={[styles.row, style]}>{children}</View>;
}

export function Avatar({name, color = T.accent}: {name: string; color?: string}) {
  return (
    <View style={[styles.avatar, {backgroundColor: color + '22', borderColor: color + '55'}]}>
      <Text style={[styles.avatarText, {color}]}>{initials(name)}</Text>
    </View>
  );
}

/** Brand monogram used in headers. */
export function Logo({size = 44}: {size?: number}) {
  return (
    <View
      style={[
        styles.logo,
        {width: size, height: size, borderRadius: size / 3},
      ]}>
      <Text style={[styles.logoText, {fontSize: size * 0.42}]}>⟲</Text>
    </View>
  );
}

export function Divider() {
  return <View style={styles.divider} />;
}

/** A status row with a colored leading dot and a trailing value. */
export function StatusRow({
  label,
  value,
  ok,
  warn,
  icon,
  pulse,
}: {
  label: string;
  value: string;
  ok: boolean;
  warn?: boolean;
  /** Small tinted icon chip ahead of the label, for quicker scanning. */
  icon?: IconName;
  /** Pulses the trailing dot when true and ok — a live/active cue. */
  pulse?: boolean;
}) {
  const color = ok ? T.good : warn ? T.warn : T.textFaint;
  return (
    <View style={styles.statusRow}>
      <Row style={{justifyContent: 'flex-start', flex: 1}}>
        {icon && (
          <View style={[styles.statusIcon, {backgroundColor: color + '1f'}]}>
            <Icon name={icon} size={15} color={color} strokeWidth={2.2} />
          </View>
        )}
        <Text style={styles.statusLabel}>{label}</Text>
      </Row>
      <View style={styles.row}>
        <PulseDot color={color} active={!!pulse && ok} />
        <Text style={[styles.statusValue, {color}]}>{value}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: T.card,
    borderRadius: T.radius,
    borderWidth: 1,
    borderColor: T.border,
    marginBottom: T.space,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: {width: 0, height: 4},
    elevation: 3,
  },
  cardTranslucent: {
    backgroundColor: T.card + '99',
    elevation: 0,
  },
  cardGlow: {
    borderColor: T.accent + '33',
    shadowColor: T.accent,
    shadowOpacity: 0.3,
    shadowRadius: 18,
    shadowOffset: {width: 0, height: 6},
    elevation: 6,
  },
  h1: {color: T.text, fontSize: 26, fontWeight: '800', letterSpacing: -0.5},
  h2: {color: T.text, fontSize: 16, fontWeight: '700', marginBottom: 12},
  sectionLabel: {
    color: T.textFaint,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
    marginBottom: 10,
    textTransform: 'uppercase',
  },
  p: {color: T.text, fontSize: 14, lineHeight: 21},
  fieldLabel: {color: T.textDim, fontSize: 12, marginBottom: 7, fontWeight: '700', letterSpacing: 0.3},
  input: {
    backgroundColor: T.bgElev,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: T.border,
    color: T.text,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
  },
  btn: {
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  btnGlow: {
    shadowColor: T.accent,
    shadowOpacity: 0.45,
    shadowRadius: 14,
    shadowOffset: {width: 0, height: 5},
    elevation: 5,
  },
  btnText: {fontWeight: '800', fontSize: 15, letterSpacing: 0.2},
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 6,
  },
  pillText: {fontSize: 11, fontWeight: '800', letterSpacing: 0.4},
  dot: {width: 8, height: 8, borderRadius: 4},
  pulseWrap: {width: 8, height: 8, marginRight: 7, alignItems: 'center', justifyContent: 'center'},
  pulseRing: {
    position: 'absolute',
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 1.5,
  },
  statusIcon: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  row: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'},
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {fontWeight: '800', fontSize: 15},
  logo: {
    backgroundColor: T.accent,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: T.accent,
    shadowOpacity: 0.5,
    shadowRadius: 12,
    shadowOffset: {width: 0, height: 4},
    elevation: 6,
  },
  logoText: {color: '#fff', fontWeight: '900'},
  divider: {height: 1, backgroundColor: T.borderSoft, marginVertical: 14},
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 9,
  },
  statusLabel: {color: T.text, fontSize: 14, fontWeight: '500'},
  statusValue: {fontSize: 13, fontWeight: '700'},
});
