/** Notifications tab — a list of app notifications with read/unread state. */
import React, {useEffect, useReducer} from 'react';
import {FlatList, StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {C, relTime} from '../ui/chatTheme';
import {ChatHeader} from '../chat/ui';
import {Icon, type IconName} from '../ui/Icon';
import {
  getNotifs,
  loadNotifs,
  markAllRead,
  markRead,
  subscribeNotifs,
  unreadCount,
  type Notif,
  type NotifKind,
} from './store';

const ICON: Record<NotifKind, IconName> = {
  message: 'message',
  session: 'monitor',
  device: 'smartphone',
  system: 'bell',
};

export function NotificationsScreen() {
  const [, bump] = useReducer((x: number) => x + 1, 0);

  useEffect(() => {
    void loadNotifs().then(bump);
    return subscribeNotifs(bump);
  }, []);

  const data = getNotifs();
  const unread = unreadCount();

  return (
    <View style={styles.wrap}>
      <ChatHeader
        title="Notifications"
        subtitle={unread > 0 ? `${unread} unread` : 'All caught up'}
        right={
          unread > 0 ? (
            <TouchableOpacity onPress={markAllRead} hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}>
              <Text style={styles.markAll}>Mark all</Text>
            </TouchableOpacity>
          ) : undefined
        }
      />
      <FlatList
        data={data}
        keyExtractor={n => n.id}
        contentContainerStyle={data.length === 0 ? styles.emptyPad : styles.listPad}
        ItemSeparatorComponent={() => <View style={styles.sep} />}
        renderItem={({item}) => <Row notif={item} onPress={() => markRead(item.id)} />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <View style={styles.emptyIcon}>
              <Icon name="bell" size={34} color={C.orange} />
            </View>
            <Text style={styles.emptyTitle}>No notifications</Text>
            <Text style={styles.emptyText}>You're all caught up.</Text>
          </View>
        }
      />
    </View>
  );
}

function Row({notif, onPress}: {notif: Notif; onPress: () => void}) {
  return (
    <TouchableOpacity activeOpacity={0.6} style={styles.row} onPress={onPress}>
      <View style={[styles.icon, !notif.read && styles.iconUnread]}>
        <Icon name={ICON[notif.kind]} size={20} color={notif.read ? C.textDim : C.orange} />
      </View>
      <View style={styles.body}>
        <View style={styles.top}>
          <Text style={[styles.title, !notif.read && styles.titleUnread]} numberOfLines={1}>
            {notif.title}
          </Text>
          <Text style={styles.time}>{relTime(notif.ts)}</Text>
        </View>
        <Text style={styles.text} numberOfLines={2}>
          {notif.body}
        </Text>
      </View>
      {!notif.read ? <View style={styles.dot} /> : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  wrap: {flex: 1, backgroundColor: C.bg},
  markAll: {color: C.orange, fontSize: 14, fontWeight: '800'},
  listPad: {paddingVertical: 6},
  emptyPad: {flexGrow: 1},
  sep: {height: 1, backgroundColor: C.borderSoft, marginLeft: 78},
  row: {flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 13},
  icon: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconUnread: {backgroundColor: C.orangeSoft, borderColor: C.orangeLine},
  body: {flex: 1, marginLeft: 14},
  top: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'},
  title: {color: C.textDim, fontSize: 15.5, fontWeight: '700', flex: 1, marginRight: 10},
  titleUnread: {color: C.text},
  time: {color: C.textFaint, fontSize: 12, fontWeight: '600'},
  text: {color: C.textDim, fontSize: 13.5, marginTop: 3, lineHeight: 19},
  dot: {width: 9, height: 9, borderRadius: 5, backgroundColor: C.orange, marginLeft: 10},
  empty: {flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40},
  emptyIcon: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: C.orangeSoft,
    borderWidth: 1.5,
    borderColor: C.orangeLine,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyTitle: {color: C.text, fontSize: 18, fontWeight: '800', marginBottom: 6},
  emptyText: {color: C.textDim, fontSize: 14, textAlign: 'center'},
});
