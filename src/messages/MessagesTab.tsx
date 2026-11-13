/**
 * Messages tab: the list of admins this device has talked with (one row
 * each: last message, time, unread count, message count), and tapping one
 * opens that conversation (InboxScreen). Built from the same inbox store —
 * live gateway messages plus GET /v1/agent/messages history.
 */
import React, {useEffect, useReducer, useState} from 'react';
import {BackHandler, FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {C, relTime} from '../ui/chatTheme';
import {ChatAvatar, ChatHeader} from '../chat/ui';
import {Icon} from '../ui/Icon';
import type {AgentController} from '../agent/controller';
import {InboxScreen} from './InboxScreen';
import {getConversations, getHistoryState, loadInbox, subscribeInbox, type Conversation} from './store';

export function MessagesTab({controller}: {controller: AgentController}) {
  const [open, setOpen] = useState<string | null>(null);

  // Hardware back inside a conversation returns to the list.
  useEffect(() => {
    if (!open) {
      return;
    }
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setOpen(null);
      return true;
    });
    return () => sub.remove();
  }, [open]);

  if (open) {
    return <InboxScreen controller={controller} admin={open} onBack={() => setOpen(null)} />;
  }
  return <ConversationList controller={controller} onOpen={setOpen} />;
}

function ConversationList({controller, onOpen}: {controller: AgentController; onOpen: (admin: string) => void}) {
  const [, bump] = useReducer((x: number) => x + 1, 0);

  useEffect(() => {
    void loadInbox().then(bump);
    void controller.refreshHistory();
    return subscribeInbox(bump);
  }, [controller]);

  const conversations = getConversations();
  const history = getHistoryState();
  const n = conversations.length;

  return (
    <View style={styles.wrap}>
      <ChatHeader
        title="Messages"
        subtitle={n ? `${n} ${n === 1 ? 'admin' : 'admins'} · IT support` : 'From your IT support team'}
      />
      <FlatList
        data={conversations}
        keyExtractor={c => c.admin}
        contentContainerStyle={n ? undefined : styles.emptyPad}
        refreshControl={
          <RefreshControl
            refreshing={history.loading && history.cursor === undefined}
            onRefresh={() => void controller.refreshHistory()}
            tintColor={C.orange}
            colors={[C.orange]}
          />
        }
        ItemSeparatorComponent={() => <View style={styles.sep} />}
        renderItem={({item}) => <Row conversation={item} onPress={() => onOpen(item.admin)} />}
        ListEmptyComponent={
          <View style={styles.empty}>
            {history.error ? <Text style={styles.errorText}>{history.error}</Text> : null}
            <View style={styles.emptyIcon}>
              <Icon name="inbox" size={34} color={C.orange} />
            </View>
            <Text style={styles.emptyTitle}>No messages yet</Text>
            <Text style={styles.emptyText}>When an admin messages this device, the conversation appears here.</Text>
          </View>
        }
      />
    </View>
  );
}

function Row({conversation: c, onPress}: {conversation: Conversation; onPress: () => void}) {
  const preview = (c.last.outgoing ? 'You: ' : '') + c.last.text;
  const unread = c.unread > 0;
  return (
    <TouchableOpacity activeOpacity={0.7} style={styles.row} onPress={onPress}>
      <ChatAvatar name={c.admin} size={50} seed={c.admin} />
      <View style={styles.rowBody}>
        <View style={styles.rowTop}>
          <Text style={[styles.name, unread && styles.nameUnread]} numberOfLines={1}>
            {c.admin}
          </Text>
          <Text style={[styles.time, unread && styles.timeUnread]}>{relTime(c.last.receivedAt)}</Text>
        </View>
        <View style={styles.rowBottom}>
          <Text style={[styles.preview, unread && styles.previewUnread]} numberOfLines={1}>
            {preview}
          </Text>
          {unread ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{c.unread > 99 ? '99+' : c.unread}</Text>
            </View>
          ) : (
            <Text style={styles.count}>{c.messages.length}</Text>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  wrap: {flex: 1},
  emptyPad: {flexGrow: 1},
  row: {flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12},
  rowBody: {flex: 1, marginLeft: 12},
  rowTop: {flexDirection: 'row', alignItems: 'center'},
  rowBottom: {flexDirection: 'row', alignItems: 'center', marginTop: 4},
  name: {flex: 1, color: C.text, fontSize: 15.5, fontWeight: '600'},
  nameUnread: {fontWeight: '800'},
  time: {color: C.textFaint, fontSize: 12, marginLeft: 8},
  timeUnread: {color: C.orange, fontWeight: '700'},
  preview: {flex: 1, color: C.textDim, fontSize: 13.5},
  previewUnread: {color: C.text, fontWeight: '600'},
  badge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 6,
    marginLeft: 8,
    backgroundColor: C.orange,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: C.orange,
    shadowOpacity: 0.5,
    shadowRadius: 6,
    shadowOffset: {width: 0, height: 2},
    elevation: 3,
  },
  badgeText: {color: C.onOrange, fontSize: 11, fontWeight: '800'},
  count: {color: C.textFaint, fontSize: 11.5, marginLeft: 8},
  sep: {height: StyleSheet.hairlineWidth, backgroundColor: C.borderSoft, marginLeft: 78},
  empty: {flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32},
  emptyIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: C.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyTitle: {color: C.text, fontSize: 17, fontWeight: '800'},
  emptyText: {color: C.textDim, fontSize: 13.5, textAlign: 'center', marginTop: 6, lineHeight: 19},
  errorText: {color: '#F87272', fontSize: 13, marginBottom: 12, textAlign: 'center'},
});
