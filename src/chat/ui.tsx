/** Chat-specific UI atoms (orange / black / white) using SVG icons. */
import React from 'react';
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import {C, avatarColor, chatInitials} from '../ui/chatTheme';
import {Icon, type IconName} from '../ui/Icon';

/** Round avatar with initials, an orange ring for groups, online dot for DMs. */
export function ChatAvatar({
  name,
  size = 48,
  group,
  online,
  seed,
}: {
  name: string;
  size?: number;
  group?: boolean;
  online?: boolean;
  seed?: string;
}) {
  const color = group ? C.orange : avatarColor(seed || name);
  return (
    <View style={{width: size, height: size}}>
      <View
        style={[
          styles.avatar,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: group ? C.orangeSoft : color + '26',
            borderColor: group ? C.orangeLine : color + '66',
          },
        ]}>
        {group ? (
          <Icon name="users" size={size * 0.5} color={C.orange} />
        ) : (
          <Text style={[styles.avatarText, {color, fontSize: size * 0.34}]}>
            {chatInitials(name)}
          </Text>
        )}
      </View>
      {online && !group ? (
        <View
          style={[
            styles.onlineDot,
            {width: size * 0.26, height: size * 0.26, borderRadius: size * 0.13},
          ]}
        />
      ) : null}
    </View>
  );
}

/** A circular icon button (used for header back / actions). */
export function IconButton({
  icon,
  onPress,
  active,
  size = 40,
}: {
  icon: IconName;
  onPress: () => void;
  active?: boolean;
  size?: number;
}) {
  return (
    <TouchableOpacity
      activeOpacity={0.7}
      onPress={onPress}
      hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}
      style={[
        styles.iconBtn,
        {width: size, height: size, borderRadius: size / 2},
        active && {backgroundColor: C.orangeSoft, borderColor: C.orangeLine},
      ]}>
      <Icon name={icon} size={size * 0.5} color={active ? C.orange : C.text} />
    </TouchableOpacity>
  );
}

/** Floating action button. */
export function Fab({icon, onPress, label}: {icon: IconName; onPress: () => void; label?: string}) {
  return (
    <TouchableOpacity activeOpacity={0.85} onPress={onPress} style={styles.fab}>
      <Icon name={icon} size={26} color={C.onOrange} strokeWidth={2.4} />
      {label ? <Text style={styles.fabLabel}>{label}</Text> : null}
    </TouchableOpacity>
  );
}

/** Screen header: optional back button, title block, optional trailing node. */
export function ChatHeader({
  title,
  subtitle,
  onBack,
  left,
  right,
}: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  left?: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <View style={styles.header}>
      {onBack ? <IconButton icon="back" onPress={onBack} size={38} /> : null}
      {left ? <View style={{marginLeft: onBack ? 6 : 0}}>{left}</View> : null}
      <View style={styles.headerText}>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.headerSub} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right ? <View style={styles.headerRight}>{right}</View> : null}
    </View>
  );
}

/** Primary (orange) pill button. */
export function PrimaryButton({
  title,
  onPress,
  disabled,
  style,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={onPress}
      disabled={disabled}
      style={[styles.primaryBtn, disabled && {opacity: 0.4}, style]}>
      <Text style={styles.primaryBtnText}>{title}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  avatar: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
  },
  avatarText: {fontWeight: '800', letterSpacing: 0.3},
  onlineDot: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    backgroundColor: C.online,
    borderWidth: 2,
    borderColor: C.bg,
  },
  iconBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
  },
  fab: {
    position: 'absolute',
    right: 18,
    bottom: 22,
    minWidth: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: C.orange,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    paddingHorizontal: 18,
    shadowColor: C.orange,
    shadowOpacity: 0.5,
    shadowRadius: 14,
    shadowOffset: {width: 0, height: 6},
    elevation: 8,
  },
  fabLabel: {color: C.onOrange, fontSize: 15, fontWeight: '800', marginLeft: 8},
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.borderSoft,
    backgroundColor: C.bgElev,
  },
  headerText: {flex: 1, marginLeft: 12, justifyContent: 'center'},
  headerTitle: {color: C.text, fontSize: 18, fontWeight: '800', letterSpacing: -0.3},
  headerSub: {color: C.textDim, fontSize: 12.5, marginTop: 1.5, fontWeight: '500'},
  headerRight: {flexDirection: 'row', alignItems: 'center', marginLeft: 8},
  primaryBtn: {
    backgroundColor: C.orange,
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: {color: C.onOrange, fontSize: 16, fontWeight: '800', letterSpacing: 0.2},
});
