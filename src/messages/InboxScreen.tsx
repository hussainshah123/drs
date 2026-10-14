/**
 * Inbox — the conversation between this device and its operators, as one thread:
 * live operator messages from the gateway plus history from GET /v1/agent/messages
 * (pull to refresh, scroll up for older pages), and the device's own replies,
 * sent with the composer (POST /v1/agent/messages). Opening it marks new operator
 * messages read; notifications (banner / tray / fullscreen) also offer Acknowledge
 * and Dismiss. Each change is reported to the operator (SignalMessage.message_ack).
 */
import React, {useEffect, useReducer, useState} from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {C, avatarColor, clockTime, dayLabel} from '../ui/chatTheme';
import {ChatAvatar, ChatHeader} from '../chat/ui';
import {Icon} from '../ui/Icon';
import type {AgentController} from '../agent/controller';
import {
  getHistoryState,
  getInbox,
  isExpired,
  loadInbox,
  needsAction,
  subscribeInbox,
  type InboxKind,
  type InboxMessage,
} from './store';

type Item =
  | {type: 'day'; key: string; label: string}
  | {type: 'msg'; key: string; msg: InboxMessage; showSender: boolean; tail: boolean};

const KIND_LABEL: Record<InboxKind, string> = {
  chat: '',
  banner: 'Banner',
  tray: 'Notification',
  fullscreen: 'Announcement',
};

const STATUS_LABEL: Record<InboxMessage['status'], string> = {
  delivered: '',
  read: '',
  acknowledged: 'Acknowledged',
  dismissed: 'Dismissed',
};

export function InboxScreen({controller}: {controller: AgentController}) {
  const [, bump] = useReducer((x: number) => x + 1, 0);

  useEffect(() => {
    void loadInbox().then(bump);
    void controller.refreshHistory();
    return subscribeInbox(bump);
  }, [controller]);

  const messages = getInbox();
  const history = getHistoryState();

  // Everything on screen has been seen: report incoming messages read. Outgoing
  // (the device's own replies) carry no ack state.
  useEffect(() => {
    for (const m of messages) {
      if (m.status === 'delivered' && !m.outgoing) {
        controller.updateMessage(m.id, 'read');
      }
    }
  });

  const items = buildItems(messages);

  return (
    <KeyboardAvoidingView
      style={styles.wrap}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ChatHeader
        title="Messages"
        subtitle="From your IT support team"
        left={<ChatAvatar name="Support" size={40} group />}
      />
      <FlatList
        data={items}
        inverted={items.length > 0}
        keyExtractor={it => it.key}
        contentContainerStyle={items.length ? styles.listPad : styles.emptyPad}
        refreshControl={
          <RefreshControl
            refreshing={history.loading && history.cursor === undefined}
            onRefresh={() => void controller.refreshHistory()}
            tintColor={C.orange}
            colors={[C.orange]}
          />
        }
        // Inverted: the "end" is the top of the thread, where older pages go.
        onEndReached={() => void controller.loadOlderHistory()}
        onEndReachedThreshold={0.3}
        ListFooterComponent={
          items.length ? (
            <HistoryFooter
              loading={history.loading}
              error={history.error}
              more={!!history.cursor}
              onRetry={() => void controller.loadOlderHistory()}
            />
          ) : undefined
        }
        renderItem={({item}) =>
          item.type === 'day' ? (
            <DayDivider label={item.label} />
          ) : (
            <Bubble
              item={item}
              onAcknowledge={() => controller.updateMessage(item.msg.id, 'acknowledged')}
              onDismiss={() => controller.updateMessage(item.msg.id, 'dismissed')}
            />
          )
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            {history.error ? <Text style={styles.errorText}>{history.error}</Text> : null}
            <View style={styles.emptyIcon}>
              <Icon name="inbox" size={34} color={C.orange} />
            </View>
            <Text style={styles.emptyTitle}>No messages yet</Text>
            <Text style={styles.emptyText}>
              Messages and notices from your IT team will appear here.
            </Text>
          </View>
        }
      />
      <Composer controller={controller} />
    </KeyboardAvoidingView>
  );
}

/** Composer — send a chat message from this device to the operator. */
function Composer({controller}: {controller: AgentController}) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

  const send = async () => {
    const body = text.trim();
    if (!body || sending) {
      return;
    }
    setSending(true);
    try {
      await controller.sendToOperator(body);
      setText('');
    } catch {
      // Keep the text so the person can retry; a failed send is transient.
    } finally {
      setSending(false);
    }
  };

  const canSend = text.trim().length > 0 && !sending;
  return (
    <View style={styles.composer}>
      <TextInput
        style={styles.input}
        value={text}
        onChangeText={setText}
        placeholder="Message your IT team…"
        placeholderTextColor={C.textFaint}
        multiline
        editable={!sending}
      />
      <TouchableOpacity
        activeOpacity={0.8}
        style={[styles.sendBtn, !canSend && styles.sendBtnOff]}
        onPress={send}
        disabled={!canSend}>
        {sending ? (
          <ActivityIndicator size="small" color={C.onOrange} />
        ) : (
          <Icon name="send" size={18} color={C.onOrange} strokeWidth={2.4} />
        )}
      </TouchableOpacity>
    </View>
  );
}

/** Day dividers + messages, oldest→newest, reversed for the inverted list. */
function buildItems(messages: InboxMessage[]): Item[] {
  const out: Item[] = [];
  let lastDay = '';
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    const d = dayLabel(m.receivedAt);
    if (d !== lastDay) {
      out.push({type: 'day', key: `d_${m.id}`, label: d});
      lastDay = d;
    }
    const prev = messages[i - 1];
    const next = messages[i + 1];
    const showSender = !prev || prev.sender !== m.sender || dayLabel(prev.receivedAt) !== d;
    const tail = !next || next.sender !== m.sender || dayLabel(next.receivedAt) !== d;
    out.push({type: 'msg', key: m.id, msg: m, showSender, tail});
  }
  return out.reverse();
}

/** Top of the thread: older-page loading state, an error with retry, or the start. */
function HistoryFooter({
  loading,
  error,
  more,
  onRetry,
}: {
  loading: boolean;
  error: string | null;
  more: boolean;
  onRetry: () => void;
}) {
  if (loading) {
    return <ActivityIndicator color={C.orange} style={styles.historyRow} />;
  }
  if (error) {
    return (
      <TouchableOpacity style={styles.historyRow} onPress={onRetry}>
        <Text style={styles.errorText}>{error} · Tap to retry</Text>
      </TouchableOpacity>
    );
  }
  return more ? null : (
    <View style={styles.historyRow}>
      <Text style={styles.historyText}>Start of your messages</Text>
    </View>
  );
}

function DayDivider({label}: {label: string}) {
  return (
    <View style={styles.dayRow}>
      <View style={styles.dayPill}>
        <Text style={styles.dayText}>{label}</Text>
      </View>
    </View>
  );
}

function Bubble({
  item,
  onAcknowledge,
  onDismiss,
}: {
  item: Extract<Item, {type: 'msg'}>;
  onAcknowledge: () => void;
  onDismiss: () => void;
}) {
  const {msg, showSender, tail} = item;
  const kindLabel = KIND_LABEL[msg.kind];
  const statusLabel =
    STATUS_LABEL[msg.status] || (msg.kind !== 'chat' && isExpired(msg) ? 'Expired' : '');
  const out = !!msg.outgoing;
  if (out) {
    // This device's own reply: right-aligned, no avatar or sender line.
    return (
      <View style={[styles.bubbleRow, styles.bubbleRowOut, {marginBottom: tail ? 10 : 2}]}>
        <View
          style={[
            styles.bubble,
            styles.bubbleOut,
            tail ? styles.tailOut : styles.round,
          ]}>
          <Text style={styles.bubbleTextOut}>{msg.text}</Text>
          <View style={styles.metaRow}>
            <Text style={styles.timeOut}>{clockTime(msg.receivedAt)}</Text>
          </View>
        </View>
      </View>
    );
  }
  return (
    <View style={[styles.bubbleRow, {marginBottom: tail ? 10 : 2}]}>
      <View style={styles.bubbleAvatar}>
        {tail ? <ChatAvatar name={msg.sender} size={28} seed={msg.sender} /> : null}
      </View>
      <View style={[styles.bubble, tail ? styles.tail : styles.round, msg.kind !== 'chat' && styles.notice]}>
        {showSender || kindLabel ? (
          <View style={styles.bubbleTop}>
            {showSender ? (
              <Text style={[styles.senderName, {color: avatarColor(msg.sender)}]} numberOfLines={1}>
                {msg.sender}
              </Text>
            ) : null}
            {kindLabel ? (
              <View style={styles.kindPill}>
                <Text style={styles.kindText}>{kindLabel}</Text>
              </View>
            ) : null}
          </View>
        ) : null}
        <Text style={styles.bubbleText}>{msg.text}</Text>
        {needsAction(msg) ? (
          <View style={styles.actions}>
            <TouchableOpacity activeOpacity={0.8} style={styles.ackBtn} onPress={onAcknowledge}>
              <Icon name="check" size={15} color={C.onOrange} strokeWidth={2.6} />
              <Text style={styles.ackText}>Acknowledge</Text>
            </TouchableOpacity>
            <TouchableOpacity activeOpacity={0.8} style={styles.dismissBtn} onPress={onDismiss}>
              <Text style={styles.dismissText}>Dismiss</Text>
            </TouchableOpacity>
          </View>
        ) : null}
        <View style={styles.metaRow}>
          {statusLabel ? <Text style={styles.status}>{statusLabel}</Text> : null}
          <Text style={styles.time}>{clockTime(msg.receivedAt)}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {flex: 1, backgroundColor: C.bg},
  listPad: {paddingHorizontal: 12, paddingTop: 10},
  emptyPad: {flexGrow: 1},
  dayRow: {alignItems: 'center', marginVertical: 12},
  dayPill: {
    backgroundColor: C.surface,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: C.borderSoft,
  },
  dayText: {color: C.textDim, fontSize: 11.5, fontWeight: '700', letterSpacing: 0.3},
  bubbleRow: {flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'flex-start'},
  bubbleAvatar: {width: 28, marginRight: 8, alignSelf: 'flex-end'},
  bubble: {
    maxWidth: '80%',
    paddingHorizontal: 13,
    paddingTop: 8,
    paddingBottom: 6,
    backgroundColor: C.bubbleIn,
  },
  notice: {borderWidth: 1, borderColor: C.orangeLine},
  tail: {borderRadius: 20, borderBottomLeftRadius: 6},
  round: {borderRadius: 20},
  bubbleTop: {flexDirection: 'row', alignItems: 'center', marginBottom: 3},
  senderName: {fontSize: 12.5, fontWeight: '800', marginRight: 8, flexShrink: 1},
  kindPill: {
    backgroundColor: C.orangeSoft,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  kindText: {color: C.orange, fontSize: 10.5, fontWeight: '800', letterSpacing: 0.3},
  bubbleText: {color: C.text, fontSize: 15.5, lineHeight: 21},
  actions: {flexDirection: 'row', marginTop: 10},
  ackBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.orange,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  ackText: {color: C.onOrange, fontSize: 13, fontWeight: '800', marginLeft: 5},
  dismissBtn: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    marginLeft: 8,
    borderWidth: 1,
    borderColor: C.border,
  },
  dismissText: {color: C.textDim, fontSize: 13, fontWeight: '700'},
  metaRow: {flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-end', marginTop: 3},
  status: {color: C.textFaint, fontSize: 10.5, fontWeight: '700', marginRight: 6},
  time: {color: C.textFaint, fontSize: 10.5, fontWeight: '600'},
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 8,
    borderTopWidth: 1,
    borderTopColor: C.borderSoft,
    backgroundColor: C.bgElev,
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    backgroundColor: C.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 14,
    paddingTop: Platform.OS === 'ios' ? 10 : 6,
    paddingBottom: Platform.OS === 'ios' ? 10 : 6,
    color: C.text,
    fontSize: 15.5,
    lineHeight: 20,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    marginLeft: 8,
    backgroundColor: C.orange,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnOff: {opacity: 0.4},
  bubbleRowOut: {justifyContent: 'flex-end'},
  bubbleOut: {backgroundColor: C.orange, maxWidth: '82%'},
  tailOut: {borderRadius: 20, borderBottomRightRadius: 6},
  bubbleTextOut: {color: C.onOrange, fontSize: 15.5, lineHeight: 21},
  timeOut: {color: C.onOrange, opacity: 0.75, fontSize: 10.5, fontWeight: '600'},
  historyRow: {alignItems: 'center', paddingVertical: 14},
  historyText: {color: C.textFaint, fontSize: 12, fontWeight: '600'},
  errorText: {color: C.danger, fontSize: 12.5, fontWeight: '700', marginBottom: 12},
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
