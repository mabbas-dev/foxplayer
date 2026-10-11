/**
 * FOX PLAYER — Playback Engine Selection & Diagnostics Modal
 *
 * Provides user-facing engine configuration:
 * - Auto (Recommended): Primary native player with automatic VLC fallback
 * - Native Player: Hardware-accelerated Media3 / AVPlayer
 * - VLC Player: libVLC player for broad IPTV codec/container support
 *
 * Displays live engine diagnostics and allows instant manual switching.
 */

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  TouchableWithoutFeedback,
  ScrollView,
} from 'react-native';
import Colors from '../constants/colors';
import { ENGINE_MODE, ENGINE_TYPE, ENGINE_LABELS } from '../playback/playbackTypes';
import { CheckIcon, CloseXIcon } from './Icons';

export default function PlaybackEngineModal({
  visible = false,
  onClose,
  engineMode = ENGINE_MODE.AUTO,
  activeEngineType = ENGINE_TYPE.NATIVE,
  onSelectMode,
  onSwitchEngine,
  isSwitching = false,
}) {
  if (!visible) return null;

  const modes = [
    {
      id: ENGINE_MODE.AUTO,
      title: 'Auto (Recommended)',
      subtitle: 'Attempts high-performance native engine first, automatically switches to VLC if format or codec fails.',
      tag: 'RECOMMENDED',
    },
    {
      id: ENGINE_MODE.NATIVE,
      title: 'Native Player',
      subtitle: 'AndroidX Media3 ExoPlayer (Android) / AVPlayer (iOS). Best for standard HLS, DASH, and MP4.',
      tag: 'FASTEST',
    },
    {
      id: ENGINE_MODE.VLC,
      title: 'VLC Player',
      subtitle: 'Integrated libVLC engine. Maximum format compatibility for MPEG-TS, MKV, AVI, and legacy codecs.',
      tag: 'COMPATIBLE',
    },
  ];

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.backdrop}>
          <TouchableWithoutFeedback>
            <View style={styles.modalCard}>
              {/* Header */}
              <View style={styles.header}>
                <View>
                  <Text style={styles.title}>Playback Engine</Text>
                  <Text style={styles.subtitle}>Select video decoding and streaming engine</Text>
                </View>
                <TouchableOpacity
                  style={styles.closeBtn}
                  onPress={onClose}
                  hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                >
                  <CloseXIcon size={18} color="#FFFFFF" />
                </TouchableOpacity>
              </View>

              {/* Active Engine Diagnostic Pill */}
              <View style={styles.diagnosticBanner}>
                <View style={styles.diagnosticDot} />
                <Text style={styles.diagnosticLabel}>Active Engine:</Text>
                <Text style={styles.diagnosticValue}>
                  {ENGINE_LABELS[activeEngineType] || activeEngineType}
                </Text>
                {isSwitching && (
                  <Text style={styles.switchingBadge}>Switching...</Text>
                )}
              </View>

              {/* Modes Selection */}
              <ScrollView style={styles.modesList} contentContainerStyle={{ gap: 10 }}>
                {modes.map((item) => {
                  const isSelected = engineMode === item.id;
                  return (
                    <TouchableOpacity
                      key={item.id}
                      style={[
                        styles.modeItem,
                        isSelected && styles.modeItemSelected,
                      ]}
                      onPress={() => {
                        if (typeof onSelectMode === 'function') {
                          onSelectMode(item.id);
                        }
                      }}
                      activeOpacity={0.8}
                    >
                      <View style={styles.modeContent}>
                        <View style={styles.modeTitleRow}>
                          <Text style={[styles.modeTitle, isSelected && styles.modeTitleSelected]}>
                            {item.title}
                          </Text>
                          {item.tag && (
                            <View style={[styles.tagBadge, isSelected && styles.tagBadgeSelected]}>
                              <Text style={styles.tagText}>{item.tag}</Text>
                            </View>
                          )}
                        </View>
                        <Text style={styles.modeDesc}>{item.subtitle}</Text>
                      </View>
                      <View style={[styles.radioCircle, isSelected && styles.radioCircleSelected]}>
                        {isSelected && <CheckIcon size={12} color="#FFFFFF" />}
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              {/* Quick Manual Toggle Footer */}
              <View style={styles.footer}>
                <TouchableOpacity
                  style={[styles.quickSwitchBtn, isSwitching && { opacity: 0.6 }]}
                  disabled={isSwitching}
                  onPress={() => {
                    if (typeof onSwitchEngine === 'function') {
                      const nextEngine = activeEngineType === ENGINE_TYPE.NATIVE ? ENGINE_TYPE.VLC : ENGINE_TYPE.NATIVE;
                      onSwitchEngine(nextEngine);
                    }
                  }}
                  activeOpacity={0.8}
                >
                  <Text style={styles.quickSwitchText}>
                    {activeEngineType === ENGINE_TYPE.NATIVE
                      ? '⚡ Force Switch to VLC Player Now'
                      : '⚡ Force Switch to Native Player Now'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalCard: {
    width: '100%',
    maxWidth: 460,
    backgroundColor: '#16161A',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 20,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 14,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },
  subtitle: {
    fontSize: 12,
    color: '#9CA3AF',
    marginTop: 2,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  diagnosticBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 107, 0, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255, 107, 0, 0.25)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 16,
    gap: 8,
  },
  diagnosticDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#10B981', // green active dot
  },
  diagnosticLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#9CA3AF',
  },
  diagnosticValue: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
    flex: 1,
  },
  switchingBadge: {
    fontSize: 10,
    fontWeight: '800',
    color: Colors.brand.primary,
    backgroundColor: 'rgba(255, 107, 0, 0.2)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  modesList: {
    maxHeight: 280,
  },
  modeItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 12,
    padding: 14,
    gap: 12,
  },
  modeItemSelected: {
    backgroundColor: 'rgba(255, 107, 0, 0.12)',
    borderColor: Colors.brand.primary,
  },
  modeContent: {
    flex: 1,
  },
  modeTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  modeTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#E5E7EB',
  },
  modeTitleSelected: {
    color: '#FFFFFF',
  },
  tagBadge: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  tagBadgeSelected: {
    backgroundColor: Colors.brand.primary,
  },
  tagText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  modeDesc: {
    fontSize: 11,
    color: '#9CA3AF',
    lineHeight: 16,
  },
  radioCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  radioCircleSelected: {
    borderColor: Colors.brand.primary,
    backgroundColor: Colors.brand.primary,
  },
  footer: {
    marginTop: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
    paddingTop: 12,
  },
  quickSwitchBtn: {
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickSwitchText: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.brand.primary,
  },
});
