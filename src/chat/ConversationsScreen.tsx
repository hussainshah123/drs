/** Conversations list — DMs and groups, search, and a FAB to start a new chat. */
import React, {useMemo, useState} from 'react';
import {
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {C, relTime} from '../ui/chatTheme';
import {ChatAvatar, ChatHeader, Fab, IconButton} from './ui';
import {Icon} from '../ui/Icon';
import {
  ME_ID,
  conversationMeta,
  getConversations,
  getUser,
  lastMessage,
  type Conversation,
} from './store';

export function ConversationsScreen({
  onBack,
  onOpen,
  onNew,
}: {
  onBack?: () => void;
  onOpen: (conversationId: string) => void;
  onNew: () => void;
}) {
  const [query, setQuery] = useState('');
  const conversations = getConversations();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      return conversations;
    }
    return conversations.filter(c => conversationMeta(c).title.toLowerCase().includes(q));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, conversations.length, conversations.map(c => lastMessage(c.id)?.id).join(',')]);

  return (
    <View style={styles.wrap}>
      <ChatHeader
        title="Messages"
        subtitle={`${conversations.length} conversations`}
        onBack={onBack}
        right={<IconButton icon="edit" onPress={onNew} active size={40} />}
      />

      <View style={styles.searchWrap}>
        <View style={styles.search}>
          <Icon name="search" size={18} color={C.textFaint} />
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder="Search conversations"
            placeholderTextColor={C.textFaint}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {query.length > 0 ? (
            <TouchableOpacity onPress={() => setQuery('')} style={{paddingLeft: 8}} hitSlop={{top: 10, bottom: 10, left: 10, right: 10}}>
              <Icon name="close" size={16} color={C.textFaint} />
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      <FlatList
        data={filtered}
        keyExtractor={c => c.id}
        contentContainerStyle={filtered.length === 0 ? styles.emptyPad : styles.listPad}
        ItemSeparatorComponent={() => <View style={styles.sep} />}
        keyboardShouldPersistTaps="handled"
        renderItem={({item}) => <ConversationRow conversation={item} onPress={() => onOpen(item.id)} />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <View style={styles.emptyIcon}>
              <Icon name="message" size={34} color={C.orange} />
            </View>
            <Text style={styles.emptyTitle}>No conversations</Text>
            <Text style={styles.emptyText}>Tap the + button to message a user or create a group.</Text>
          </View>
        }
      />

      <Fab icon="plus" onPress={onNew} />
    </View>
  );
}

function ConversationRow({
  conversation,
  onPress,
}: {
  conversation: Conversation;
  onPress: () => void;
}) {
  const {title, subtitle} = conversationMeta(conversation);
  const last = lastMessage(conversation.id);
  const isGroup = conversation.kind === 'group';
  const otherId = conversation.memberIds.find(id => id !== ME_ID);
  const other = otherId ? getUser(otherId) : undefined;

  let preview = subtitle;
  if (last) {
    const senderName =
      last.senderId === ME_ID ? 'You' : getUser(last.senderId)?.name.split(' ')[0] || '';
    preview = isGroup || last.senderId === ME_ID ? `${senderName}: ${last.text}` : last.text;
  }

  return (
    <TouchableOpacity activeOpacity={0.6} style={styles.row} onPress={onPress}>
      <ChatAvatar name={title} group={isGroup} online={other?.online} seed={otherId} />
      <View style={styles.rowBody}>
        <View style={styles.rowTop}>
          <Text style={styles.rowTitle} numberOfLines={1}>
            {title}
          </Text>
          {last ? <Text style={styles.rowTime}>{relTime(last.ts)}</Text> : null}
        </View>
        <Text style={styles.rowPreview} numberOfLines={1}>
          {preview}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  wrap: {flex: 1, backgroundColor: C.bg},
  searchWrap: {paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6, backgroundColor: C.bg},
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.surface,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 14,
    height: 46,
  },
  searchInput: {flex: 1, color: C.text, fontSize: 15, padding: 0, marginLeft: 10},
  listPad: {paddingVertical: 6},
  emptyPad: {flexGrow: 1},
  sep: {height: 1, backgroundColor: C.borderSoft, marginLeft: 82},
  row: {flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12},
  rowBody: {flex: 1, marginLeft: 14},
  rowTop: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'},
  rowTitle: {color: C.text, fontSize: 16.5, fontWeight: '700', flex: 1, marginRight: 10},
  rowTime: {color: C.textFaint, fontSize: 12, fontWeight: '600'},
  rowPreview: {color: C.textDim, fontSize: 14, marginTop: 3},
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
  emptyText: {color: C.textDim, fontSize: 14, textAlign: 'center', lineHeight: 20},
});
