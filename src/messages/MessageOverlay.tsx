/**
 * MessageOverlay — shows notifications that need the person's attention on top
 * of any tab: a `fullscreen` message as a takeover that must be acknowledged or
 * dismissed, and the newest `banner` message as a strip at the top. Chat and
 * tray messages only appear in the inbox (and as a system notification).
 */
import React, {useEffect, useReducer} from 'react';
import {Modal, StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {C} from '../ui/chatTheme';
import {Icon} from '../ui/Icon';
import type {AgentController} from '../agent/controller';
import {getInbox, loadInbox, needsAction, subscribeInbox} from './store';

export function MessageOverlay({
  controller,
  onOpenInbox,
}: {
  controller: AgentController;
  onOpenInbox: () => void;
}) {
  const [, bump] = useReducer((x: number) => x + 1, 0);

  useEffect(() => {
    void loadInbox().then(bump);
    return subscribeInbox(bump);
  }, []);

  const pending = getInbox().filter(needsAction);
  const takeover = pending.find(m => m.kind === 'fullscreen');
  const banner = pending.filter(m => m.kind === 'banner').pop();

  return (
    <>
      {banner && !takeover ? (
        <View style={styles.banner}>
          <TouchableOpacity activeOpacity={0.8} style={styles.bannerBody} onPress={onOpenInbox}>
            <Icon name="bell" size={18} color={C.orange} />
            <View style={styles.bannerText}>
              <Text style={styles.bannerSender} numberOfLines={1}>
                {banner.sender}
              </Text>
              <Text style={styles.bannerMsg} numberOfLines={2}>
                {banner.text}
              </Text>
            </View>
          </TouchableOpacity>
          <TouchableOpacity
            hitSlop={{top: 10, bottom: 10, left: 10, right: 10}}
            onPress={() => controller.updateMessage(banner.id, 'dismissed')}>
            <Icon name="close" size={18} color={C.textDim} />
          </TouchableOpacity>
        </View>
      ) : null}

      <Modal
        visible={!!takeover}
        animationType="fade"
        transparent
        statusBarTranslucent
        onShow={() => takeover && controller.updateMessage(takeover.id, 'read')}
        onRequestClose={() => takeover && controller.updateMessage(takeover.id, 'dismissed')}>
        {takeover ? (
          <View style={styles.backdrop}>
            <View style={styles.card}>
              <View style={styles.cardIcon}>
                <Icon name="bell" size={30} color={C.orange} />
              </View>
              <Text style={styles.cardSender}>{takeover.sender}</Text>
              <Text style={styles.cardText}>{takeover.text}</Text>
              <TouchableOpacity
                activeOpacity={0.85}
                style={styles.ackBtn}
                onPress={() => controller.updateMessage(takeover.id, 'acknowledged')}>
                <Text style={styles.ackText}>Acknowledge</Text>
              </TouchableOpacity>
              <TouchableOpacity
                activeOpacity={0.7}
                style={styles.dismissBtn}
                onPress={() => controller.updateMessage(takeover.id, 'dismissed')}>
                <Text style={styles.dismissText}>Dismiss</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    top: 8,
    left: 10,
    right: 10,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.orangeLine,
    paddingHorizontal: 14,
    paddingVertical: 11,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 12,
    shadowOffset: {width: 0, height: 4},
    elevation: 10,
  },
  bannerBody: {flex: 1, flexDirection: 'row', alignItems: 'center'},
  bannerText: {flex: 1, marginLeft: 12, marginRight: 8},
  bannerSender: {color: C.orange, fontSize: 12.5, fontWeight: '800'},
  bannerMsg: {color: C.text, fontSize: 14, marginTop: 1, lineHeight: 19},
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: C.bgElev,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: C.border,
    padding: 24,
    alignItems: 'center',
  },
  cardIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: C.orangeSoft,
    borderWidth: 1.5,
    borderColor: C.orangeLine,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  cardSender: {color: C.textDim, fontSize: 13, fontWeight: '800', letterSpacing: 0.3, marginBottom: 8},
  cardText: {color: C.text, fontSize: 17, lineHeight: 24, textAlign: 'center', marginBottom: 22},
  ackBtn: {
    alignSelf: 'stretch',
    backgroundColor: C.orange,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  ackText: {color: C.onOrange, fontSize: 16, fontWeight: '800'},
  dismissBtn: {alignSelf: 'stretch', paddingVertical: 12, alignItems: 'center', marginTop: 6},
  dismissText: {color: C.textDim, fontSize: 15, fontWeight: '700'},
});
