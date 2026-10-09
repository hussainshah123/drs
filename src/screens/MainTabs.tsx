/**
 * MainTabs — the enrolled-device shell with a bottom tab bar:
 * Home · Messages · Alerts · Access (permissions). Renders the active tab only
 * (others unmount, so their back handlers / timers don't run in the background).
 */
import React, {useEffect, useReducer, useState} from 'react';
import {StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {T} from '../ui/theme';
import {Icon, type IconName} from '../ui/Icon';
import {StatusScreen} from './StatusScreen';
import {PermissionsScreen} from './PermissionsScreen';
import {ChatApp} from '../chat/ChatApp';
import {NotificationsScreen} from '../notifications/NotificationsScreen';
import {loadNotifs, subscribeNotifs, unreadCount} from '../notifications/store';
import type {AgentController} from '../agent/controller';

type TabKey = 'home' | 'messages' | 'alerts' | 'access';

const TABS: {key: TabKey; label: string; icon: IconName}[] = [
  {key: 'home', label: 'Home', icon: 'home'},
  {key: 'messages', label: 'Messages', icon: 'message'},
  {key: 'alerts', label: 'Alerts', icon: 'bell'},
  {key: 'access', label: 'Access', icon: 'shield'},
];

export function MainTabs({
  controller,
  onOpenSettings,
  onUnenroll,
}: {
  controller: AgentController;
  onOpenSettings: () => void;
  onUnenroll: () => void;
}) {
  const [tab, setTab] = useState<TabKey>('home');
  const [, bump] = useReducer((x: number) => x + 1, 0);

  useEffect(() => {
    void loadNotifs().then(bump);
    return subscribeNotifs(bump);
  }, []);

  const unread = unreadCount();

  let screen: React.ReactNode = null;
  switch (tab) {
    case 'home':
      screen = <StatusScreen controller={controller} />;
      break;
    case 'messages':
      screen = <ChatApp onExit={() => setTab('home')} />;
      break;
    case 'alerts':
      screen = <NotificationsScreen />;
      break;
    case 'access':
      screen = (
        <PermissionsScreen
          controller={controller}
          onOpenSettings={onOpenSettings}
          onUnenroll={onUnenroll}
        />
      );
      break;
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.body}>{screen}</View>
      <View style={styles.tabBar}>
        {TABS.map(t => {
          const active = tab === t.key;
          const badge = t.key === 'alerts' ? unread : 0;
          return (
            <TouchableOpacity
              key={t.key}
              activeOpacity={0.7}
              style={styles.tab}
              onPress={() => setTab(t.key)}>
              <View style={[styles.iconWrap, active && styles.iconWrapActive]}>
                <Icon name={t.icon} size={22} color={active ? T.accent : T.textFaint} strokeWidth={active ? 2.3 : 2} />
                {badge > 0 ? (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{badge > 99 ? '99+' : badge}</Text>
                  </View>
                ) : null}
              </View>
              <Text style={[styles.label, active && styles.labelActive]} numberOfLines={1}>
                {t.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {flex: 1, backgroundColor: T.bg},
  body: {flex: 1},
  tabBar: {
    flexDirection: 'row',
    backgroundColor: T.bgElev,
    borderTopWidth: 1,
    borderTopColor: T.borderSoft,
    paddingTop: 8,
    paddingBottom: 10,
  },
  tab: {flex: 1, alignItems: 'center', justifyContent: 'center'},
  iconWrap: {
    width: 52,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrapActive: {backgroundColor: T.accentSoft},
  label: {color: T.textFaint, fontSize: 11, fontWeight: '700', marginTop: 3},
  labelActive: {color: T.accent, fontWeight: '800'},
  badge: {
    position: 'absolute',
    top: -3,
    right: 6,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: T.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    borderWidth: 2,
    borderColor: T.bgElev,
  },
  badgeText: {color: '#1A0E00', fontSize: 10, fontWeight: '900'},
});
