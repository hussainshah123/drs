/** New chat — pick a user to message directly, or start a new group. */
import React, {useMemo, useState} from 'react';
import {FlatList, StyleSheet, Text, TextInput, TouchableOpacity, View} from 'react-native';
import {C} from '../ui/chatTheme';
import {ChatAvatar, ChatHeader} from './ui';
import {Icon} from '../ui/Icon';
import {getContacts, openDirect, type ChatUser} from './store';

export function NewChatScreen({
  onBack,
  onOpen,
  onNewGroup,
}: {
  onBack: () => void;
  onOpen: (conversationId: string) => void;
  onNewGroup: () => void;
}) {
  const [query, setQuery] = useState('');
  const contacts = getContacts();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      return contacts;
    }
    return contacts.filter(u => u.name.toLowerCase().includes(q) || u.handle.toLowerCase().includes(q));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, contacts.length]);

  return (
    <View style={styles.wrap}>
      <ChatHeader title="New message" subtitle="Choose a person or group" onBack={onBack} />

      <View style={styles.searchWrap}>
        <View style={styles.search}>
          <Icon name="search" size={18} color={C.textFaint} />
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder="Search people"
            placeholderTextColor={C.textFaint}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>
      </View>

      <FlatList
        data={filtered}
        keyExtractor={u => u.id}
        contentContainerStyle={styles.listPad}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <TouchableOpacity activeOpacity={0.6} style={styles.groupCta} onPress={onNewGroup}>
            <View style={styles.groupIcon}>
              <Icon name="users" size={22} color={C.orange} />
            </View>
            <Text style={styles.groupText}>Create a new group</Text>
            <Icon name="chevron" size={20} color={C.textFaint} />
          </TouchableOpacity>
        }
        ItemSeparatorComponent={() => <View style={styles.sep} />}
        renderItem={({item}) => <ContactRow user={item} onPress={() => onOpen(openDirect(item.id))} />}
        ListFooterComponent={<View style={{height: 24}} />}
      />
    </View>
  );
}

function ContactRow({user, onPress}: {user: ChatUser; onPress: () => void}) {
  return (
    <TouchableOpacity activeOpacity={0.6} style={styles.row} onPress={onPress}>
      <ChatAvatar name={user.name} online={user.online} seed={user.id} />
      <View style={styles.rowBody}>
        <Text style={styles.name}>{user.name}</Text>
        <Text style={styles.handle}>
          @{user.handle} · {user.online ? 'Online' : 'Offline'}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  wrap: {flex: 1, backgroundColor: C.bg},
  searchWrap: {paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6},
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
  groupCta: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 4,
  },
  groupIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: C.orangeSoft,
    borderWidth: 1.5,
    borderColor: C.orangeLine,
    alignItems: 'center',
    justifyContent: 'center',
  },
  groupText: {flex: 1, color: C.orange, fontSize: 16, fontWeight: '800', marginLeft: 14},
  sep: {height: 1, backgroundColor: C.borderSoft, marginLeft: 78},
  row: {flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 11},
  rowBody: {flex: 1, marginLeft: 14},
  name: {color: C.text, fontSize: 16, fontWeight: '700'},
  handle: {color: C.textDim, fontSize: 13, marginTop: 2},
});
