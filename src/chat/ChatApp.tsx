/**
 * ChatApp — a self-contained messaging module with its own internal stack
 * navigator. Mounts inside the host app (which provides the SafeAreaView) and
 * calls onExit() when the user backs out of the conversations list.
 *
 * Screens: conversations list → thread, plus new-chat / new-group / info.
 * Everything is local (see store.ts); no backend.
 */
import React, {useEffect, useReducer, useState} from 'react';
import {BackHandler, StyleSheet, View} from 'react-native';
import {C} from '../ui/chatTheme';
import {loadChat, subscribe, getConversation} from './store';
import {ConversationsScreen} from './ConversationsScreen';
import {ThreadScreen} from './ThreadScreen';
import {NewChatScreen} from './NewChatScreen';
import {NewGroupScreen} from './NewGroupScreen';
import {InfoScreen} from './InfoScreen';

type Screen =
  | {name: 'list'}
  | {name: 'thread'; conversationId: string}
  | {name: 'new'}
  | {name: 'newgroup'}
  | {name: 'info'; conversationId: string};

export function ChatApp({onExit}: {onExit: () => void}) {
  const [stack, setStack] = useState<Screen[]>([{name: 'list'}]);
  const [, bump] = useReducer((x: number) => x + 1, 0);

  // Load persisted conversations once, and re-render on any store change.
  useEffect(() => {
    void loadChat().then(bump);
    return subscribe(bump);
  }, []);

  const top = stack[stack.length - 1];

  const push = (s: Screen) => setStack(prev => [...prev, s]);
  const replaceTopWith = (s: Screen) =>
    setStack(prev => [...prev.slice(0, -1), s]);
  const pop = () => {
    if (stack.length <= 1) {
      onExit();
      return;
    }
    setStack(prev => prev.slice(0, -1));
  };

  // Android hardware back maps to in-stack back / exit.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      pop();
      return true;
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stack.length]);

  // When opening a conversation from new-chat / new-group, replace those
  // transient screens so Back from the thread returns to the list.
  const openConversation = (conversationId: string) => {
    setStack(prev => {
      const base = prev.filter(s => s.name === 'list');
      return [...(base.length ? base : [{name: 'list'} as Screen]), {name: 'thread', conversationId}];
    });
  };

  let screen: React.ReactNode = null;
  switch (top.name) {
    case 'list':
      screen = (
        <ConversationsScreen
          onOpen={id => push({name: 'thread', conversationId: id})}
          onNew={() => push({name: 'new'})}
        />
      );
      break;
    case 'thread': {
      const conv = getConversation(top.conversationId);
      screen = (
        <ThreadScreen
          conversationId={top.conversationId}
          onBack={pop}
          onOpenInfo={conv ? () => push({name: 'info', conversationId: top.conversationId}) : undefined}
        />
      );
      break;
    }
    case 'new':
      screen = (
        <NewChatScreen
          onBack={pop}
          onOpen={openConversation}
          onNewGroup={() => replaceTopWith({name: 'newgroup'})}
        />
      );
      break;
    case 'newgroup':
      screen = <NewGroupScreen onBack={pop} onCreated={openConversation} />;
      break;
    case 'info':
      screen = <InfoScreen conversationId={top.conversationId} onBack={pop} />;
      break;
  }

  return <View style={styles.wrap}>{screen}</View>;
}

const styles = StyleSheet.create({
  wrap: {flex: 1, backgroundColor: C.bg},
});
