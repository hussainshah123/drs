/** Conversation info — group members or a DM profile. */
import React from 'react';
import {ScrollView, StyleSheet, Text, View} from 'react-native';
import {C} from '../ui/chatTheme';
import {ChatAvatar, ChatHeader} from './ui';
import {ME_ID, conversationMeta, getConversation, getUser} from './store';

export function InfoScreen({conversationId, onBack}: {conversationId: string; onBack: () => void}) {
  const conv = getConversation(conversationId);
  if (!conv) {
    return (
      <View style={styles.wrap}>
        <ChatHeader title="Details" onBack={onBack} />
      </View>
    );
  }
  const {title} = conversationMeta(conv);
  const isGroup = conv.kind === 'group';
  const members = conv.memberIds.map(id => getUser(id)).filter(Boolean);

  return (
    <View style={styles.wrap}>
      <ChatHeader title={isGroup ? 'Group info' : 'Contact info'} onBack={onBack} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <ChatAvatar name={title} size={88} group={isGroup} />
          <Text style={styles.heroTitle}>{title}</Text>
          <Text style={styles.heroSub}>
            {isGroup ? `${conv.memberIds.length} members` : `@${members.find(m => m?.id !== ME_ID)?.handle || ''}`}
          </Text>
        </View>

        <Text style={styles.sectionLabel}>{isGroup ? 'MEMBERS' : 'ABOUT'}</Text>
        <View style={styles.card}>
          {members.map((m, i) => (
            <View key={m!.id} style={[styles.row, i > 0 && styles.rowBorder]}>
              <ChatAvatar name={m!.name} size={42} online={m!.online} seed={m!.id} />
              <View style={styles.rowBody}>
                <Text style={styles.name}>
                  {m!.name}
                  {m!.id === ME_ID ? ' (You)' : ''}
                </Text>
                <Text style={styles.handle}>@{m!.handle}</Text>
              </View>
              {m!.role === 'admin' ? (
                <View style={styles.adminTag}>
                  <Text style={styles.adminText}>ADMIN</Text>
                </View>
              ) : m!.online ? (
                <Text style={styles.onlineText}>online</Text>
              ) : null}
            </View>
          ))}
        </View>
        <View style={{height: 30}} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {flex: 1, backgroundColor: C.bg},
  content: {padding: 16},
  hero: {alignItems: 'center', paddingVertical: 20},
  heroTitle: {color: C.text, fontSize: 24, fontWeight: '800', marginTop: 14, letterSpacing: -0.4},
  heroSub: {color: C.textDim, fontSize: 14, marginTop: 4},
  sectionLabel: {
    color: C.textFaint,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
    marginBottom: 10,
    marginTop: 10,
  },
  card: {backgroundColor: C.surface, borderRadius: 16, borderWidth: 1, borderColor: C.border, paddingHorizontal: 14},
  row: {flexDirection: 'row', alignItems: 'center', paddingVertical: 12},
  rowBorder: {borderTopWidth: 1, borderTopColor: C.borderSoft},
  rowBody: {flex: 1, marginLeft: 12},
  name: {color: C.text, fontSize: 15.5, fontWeight: '700'},
  handle: {color: C.textDim, fontSize: 13, marginTop: 2},
  adminTag: {backgroundColor: C.orangeSoft, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: C.orangeLine},
  adminText: {color: C.orange, fontSize: 10, fontWeight: '800', letterSpacing: 0.6},
  onlineText: {color: C.online, fontSize: 12, fontWeight: '700'},
});
