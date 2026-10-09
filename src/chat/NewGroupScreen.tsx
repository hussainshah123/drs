/** New group — name the group and select members, then create it. */
import React, {useMemo, useState} from 'react';
import {FlatList, StyleSheet, Text, TextInput, TouchableOpacity, View} from 'react-native';
import {C} from '../ui/chatTheme';
import {ChatAvatar, ChatHeader, PrimaryButton} from './ui';
import {Icon} from '../ui/Icon';
import {createGroup, getContacts, type ChatUser} from './store';

export function NewGroupScreen({
  onBack,
  onCreated,
}: {
  onBack: () => void;
  onCreated: (conversationId: string) => void;
}) {
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
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

  const toggle = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const canCreate = name.trim().length > 0 && selected.size > 0;
  const selectedUsers = contacts.filter(u => selected.has(u.id));

  return (
    <View style={styles.wrap}>
      <ChatHeader title="New group" subtitle={`${selected.size} selected`} onBack={onBack} />

      <View style={styles.nameWrap}>
        <View style={styles.nameAvatar}>
          <Icon name="users" size={24} color={C.orange} />
        </View>
        <TextInput
          style={styles.nameInput}
          value={name}
          onChangeText={setName}
          placeholder="Group name"
          placeholderTextColor={C.textFaint}
          autoCapitalize="words"
        />
      </View>

      {selectedUsers.length > 0 ? (
        <FlatList
          data={selectedUsers}
          horizontal
          keyExtractor={u => 'chip_' + u.id}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipsPad}
          style={styles.chips}
          renderItem={({item}) => (
            <TouchableOpacity activeOpacity={0.7} style={styles.chip} onPress={() => toggle(item.id)}>
              <ChatAvatar name={item.name} size={26} seed={item.id} />
              <Text style={styles.chipText}>{item.name.split(' ')[0]}</Text>
              <View style={{marginLeft: 8}}>
                <Icon name="close" size={13} color={C.textFaint} />
              </View>
            </TouchableOpacity>
          )}
        />
      ) : null}

      <View style={styles.searchWrap}>
        <View style={styles.search}>
          <Icon name="search" size={18} color={C.textFaint} />
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder="Add members"
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
        ItemSeparatorComponent={() => <View style={styles.sep} />}
        renderItem={({item}) => (
          <MemberRow user={item} checked={selected.has(item.id)} onPress={() => toggle(item.id)} />
        )}
      />

      <View style={styles.footer}>
        <PrimaryButton
          title={canCreate ? `Create group · ${selected.size + 1}` : 'Create group'}
          disabled={!canCreate}
          onPress={() => onCreated(createGroup(name, Array.from(selected)))}
        />
      </View>
    </View>
  );
}

function MemberRow({
  user,
  checked,
  onPress,
}: {
  user: ChatUser;
  checked: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity activeOpacity={0.6} style={styles.row} onPress={onPress}>
      <ChatAvatar name={user.name} online={user.online} seed={user.id} />
      <View style={styles.rowBody}>
        <Text style={styles.name}>{user.name}</Text>
        <Text style={styles.handle}>@{user.handle}</Text>
      </View>
      <View style={[styles.check, checked && styles.checkOn]}>
        {checked ? <Icon name="check" size={15} color={C.onOrange} strokeWidth={3} /> : null}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  wrap: {flex: 1, backgroundColor: C.bg},
  nameWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: C.borderSoft,
  },
  nameAvatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: C.orangeSoft,
    borderWidth: 1.5,
    borderColor: C.orangeLine,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nameInput: {
    flex: 1,
    marginLeft: 14,
    color: C.text,
    fontSize: 18,
    fontWeight: '700',
    padding: 0,
  },
  chips: {maxHeight: 76, flexGrow: 0},
  chipsPad: {paddingHorizontal: 12, paddingVertical: 12, gap: 8},
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.surface,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: C.border,
    paddingLeft: 4,
    paddingRight: 12,
    paddingVertical: 4,
    marginRight: 8,
  },
  chipText: {color: C.text, fontSize: 13.5, fontWeight: '700', marginLeft: 8},
  searchWrap: {paddingHorizontal: 16, paddingTop: 12, paddingBottom: 6},
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
  listPad: {paddingVertical: 6, paddingBottom: 20},
  sep: {height: 1, backgroundColor: C.borderSoft, marginLeft: 78},
  row: {flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 11},
  rowBody: {flex: 1, marginLeft: 14},
  name: {color: C.text, fontSize: 16, fontWeight: '700'},
  handle: {color: C.textDim, fontSize: 13, marginTop: 2},
  check: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    borderColor: C.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: {backgroundColor: C.orange, borderColor: C.orange},
  footer: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: C.borderSoft,
    backgroundColor: C.bgElev,
  },
});
