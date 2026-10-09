/** Message thread — bubbles, day dividers, and a composer bar. */
import React, {useEffect, useMemo, useRef, useState} from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {C, avatarColor, clockTime, dayLabel} from '../ui/chatTheme';
import {ChatAvatar, ChatHeader, IconButton} from './ui';
import {Icon} from '../ui/Icon';
import {
  ME_ID,
  conversationMeta,
  getConversation,
  getMessages,
  getUser,
  sendMessage,
  type Message,
} from './store';

type Item =
  | {type: 'day'; key: string; label: string}
  | {type: 'msg'; key: string; msg: Message; showSender: boolean; tail: boolean};

export function ThreadScreen({
  conversationId,
  onBack,
  onOpenInfo,
}: {
  conversationId: string;
  onBack: () => void;
  onOpenInfo?: () => void;
}) {
  const conv = getConversation(conversationId);
  const [draft, setDraft] = useState('');
  const [, force] = useState(0);
  const listRef = useRef<FlatList<Item>>(null);

  const messages = getMessages(conversationId);

  // Build a flat list of day dividers + messages, oldest→newest, then invert.
  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    let lastDay = '';
    const isGroup = conv?.kind === 'group';
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i];
      const d = dayLabel(m.ts);
      if (d !== lastDay) {
        out.push({type: 'day', key: `d_${m.id}`, label: d});
        lastDay = d;
      }
      const prev = messages[i - 1];
      const next = messages[i + 1];
      const showSender = isGroup && m.senderId !== ME_ID && (!prev || prev.senderId !== m.senderId || dayLabel(prev.ts) !== d);
      const tail = !next || next.senderId !== m.senderId || dayLabel(next.ts) !== d;
      out.push({type: 'msg', key: m.id, msg: m, showSender, tail});
    }
    return out.reverse();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length, conversationId]);

  useEffect(() => {
    // Keep pinned to newest (inverted list → offset 0 is the bottom).
    listRef.current?.scrollToOffset({offset: 0, animated: true});
  }, [messages.length]);

  if (!conv) {
    return (
      <View style={styles.wrap}>
        <ChatHeader title="Conversation" onBack={onBack} />
      </View>
    );
  }

  const {title, subtitle} = conversationMeta(conv);
  const isGroup = conv.kind === 'group';
  const otherId = conv.memberIds.find(id => id !== ME_ID);
  const other = otherId ? getUser(otherId) : undefined;

  const onSend = () => {
    const text = draft.trim();
    if (!text) {
      return;
    }
    sendMessage(conversationId, text);
    setDraft('');
    force(x => x + 1);
  };

  return (
    <View style={styles.wrap}>
      <ChatHeader
        title={title}
        subtitle={isGroup ? subtitle : other?.online ? 'Online' : 'Offline'}
        onBack={onBack}
        left={
          <TouchableOpacity activeOpacity={0.7} onPress={onOpenInfo} disabled={!onOpenInfo}>
            <ChatAvatar name={title} size={40} group={isGroup} online={other?.online} seed={otherId} />
          </TouchableOpacity>
        }
        right={onOpenInfo ? <IconButton icon="info" onPress={onOpenInfo} size={40} /> : undefined}
      />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}>
        <FlatList
          ref={listRef}
          data={items}
          inverted
          keyExtractor={it => it.key}
          contentContainerStyle={styles.listPad}
          keyboardShouldPersistTaps="handled"
          renderItem={({item}) =>
            item.type === 'day' ? (
              <DayDivider label={item.label} />
            ) : (
              <Bubble item={item} isGroup={isGroup} />
            )
          }
          ListFooterComponent={<View style={{height: 8}} />}
        />

        <View style={styles.composer}>
          <View style={styles.inputWrap}>
            <TextInput
              style={styles.input}
              value={draft}
              onChangeText={setDraft}
              placeholder="Message"
              placeholderTextColor={C.textFaint}
              multiline
            />
          </View>
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={onSend}
            disabled={!draft.trim()}
            style={[styles.sendBtn, !draft.trim() && styles.sendBtnOff]}>
            <Icon name="send" size={18} color={draft.trim() ? C.onOrange : C.textFaint} strokeWidth={2.2} />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
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

function Bubble({item, isGroup}: {item: Extract<Item, {type: 'msg'}>; isGroup: boolean}) {
  const {msg, showSender, tail} = item;
  const mine = msg.senderId === ME_ID;
  const sender = getUser(msg.senderId);
  return (
    <View style={[styles.bubbleRow, mine ? styles.rowMine : styles.rowTheirs, {marginBottom: tail ? 10 : 2}]}>
      {!mine && isGroup ? (
        <View style={styles.bubbleAvatar}>
          {tail ? <ChatAvatar name={sender?.name || '?'} size={28} seed={msg.senderId} /> : null}
        </View>
      ) : null}
      <View
        style={[
          styles.bubble,
          mine ? styles.bubbleMine : styles.bubbleTheirs,
          mine
            ? tail
              ? styles.tailMine
              : styles.roundMine
            : tail
            ? styles.tailTheirs
            : styles.roundTheirs,
        ]}>
        {showSender ? (
          <Text style={[styles.senderName, {color: avatarColor(msg.senderId)}]}>
            {sender?.name || 'Unknown'}
          </Text>
        ) : null}
        <Text style={[styles.bubbleText, mine ? styles.textMine : styles.textTheirs]}>{msg.text}</Text>
        <Text style={[styles.time, mine ? styles.timeMine : styles.timeTheirs]}>{clockTime(msg.ts)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {flex: 1, backgroundColor: C.bg},
  flex: {flex: 1},
  listPad: {paddingHorizontal: 12, paddingTop: 10},
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
  bubbleRow: {flexDirection: 'row', alignItems: 'flex-end'},
  rowMine: {justifyContent: 'flex-end'},
  rowTheirs: {justifyContent: 'flex-start'},
  bubbleAvatar: {width: 28, marginRight: 8, alignSelf: 'flex-end'},
  bubble: {maxWidth: '78%', paddingHorizontal: 13, paddingTop: 8, paddingBottom: 6},
  bubbleMine: {backgroundColor: C.bubbleOut},
  bubbleTheirs: {backgroundColor: C.bubbleIn},
  tailMine: {borderRadius: 20, borderBottomRightRadius: 6},
  roundMine: {borderRadius: 20},
  tailTheirs: {borderRadius: 20, borderBottomLeftRadius: 6},
  roundTheirs: {borderRadius: 20},
  senderName: {fontSize: 12.5, fontWeight: '800', marginBottom: 3},
  bubbleText: {fontSize: 15.5, lineHeight: 21},
  textMine: {color: C.onOrange},
  textTheirs: {color: C.text},
  time: {fontSize: 10.5, fontWeight: '600', alignSelf: 'flex-end', marginTop: 3},
  timeMine: {color: 'rgba(26,14,0,0.55)'},
  timeTheirs: {color: C.textFaint},
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 10,
    borderTopWidth: 1,
    borderTopColor: C.borderSoft,
    backgroundColor: C.bgElev,
  },
  inputWrap: {
    flex: 1,
    backgroundColor: C.surface,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 16,
    paddingVertical: Platform.OS === 'ios' ? 10 : 4,
    maxHeight: 120,
    justifyContent: 'center',
  },
  input: {color: C.text, fontSize: 15.5, padding: 0, maxHeight: 100},
  sendBtn: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: C.orange,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  sendBtnOff: {backgroundColor: C.surfaceAlt},
});
