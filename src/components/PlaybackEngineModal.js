/**
 * FOX PLAYER — Playback Engine Selection & Diagnostics Modal
 *
 * Provides user-facing engine configuration:
 * - Auto (Recommended): Primary native player with automatic VLC fallback
 * - Native Player: Hardware-accelerated Media3 / AVPlayer
 * - VLC Player: libVLC player for broad IPTV codec/container support (disabled if not compiled in)
 *
 * Displays live engine diagnostics and allows instant manual switching safely.
 */

import React, { useMemo } from 'react';
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
import { getAvailablePlayerEngines } from '../playback/playerSettings';
import { CheckIcon, CloseXIcon } from './Icons';

export default function PlaybackEngineModal({
  visible = false,
  onClose,
  onDismiss,
  engineMode = ENGINE_MODE.AUTO,
  activeEngineType = ENGINE_TYPE.NATIVE,
  onSelectMode,
  onSwitchEngine,
  isSwitching = false,
}) {
  const handleClose = onClose || onDismiss || (() => {});

  const availableEngines = useMemo(() => {
    return getAvailablePlayerEngines(activeEngineType);
  }, [activeEngineType, visible]);

  if (!visible) return null;

  const canSwitchToOther = availableEngines.some(
    (e) => e.id !== activeEngineType && e.isAvailable
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      supportedOrientations={['portrait', 'portrait-upside-down', 'landscape', 'landscape-left', 'landscape-right']}
      statusBarTranslucent={true}
      onRequestClose={handleClose}
    >
      <TouchableWithoutFeedback onPress={handleClose}>
        <View style={styles.backdrop}>
          <TouchableWithoutFeedback onPress={(e) => e?.stopPropagation?.()}>
            <View style={styles.modalCard}>
              {/* Header */}
              <View style={styles.header}>
                <View style={{ flex: 1, paddingRight: 12 }}>
                  <Text style={styles.title}>Playback Engine</Text>
                  <Text style={styles.subtitle}>Select video decoding and streaming engine</Text>
                </View>
                <TouchableOpacity
                  style={styles.closeBtn}
                  onPress={handleClose}
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
              <ScrollView
                style={styles.modesList}
                contentContainerStyle={{ gap: 10, paddingBottom: 4 }}
                showsVerticalScrollIndicator={false}
              >
                {availableEngines.map((item) => {
                  const isSelected = engineMode === item.id;
                  const isDisabled = !item.isAvailable;

                  return (
                    <TouchableOpacity
                      key={item.id}
                      style={[
                        styles.modeItem,
                        isSelected && styles.modeItemSelected,
                        isDisabled && styles.modeItemDisabled,
                      ]}
                      disabled={isDisabled}
                      onPress={() => {
                        try {
                          if (typeof onSelectMode === 'function') {
                            onSelectMode(item.id);
                          }
                          handleClose();
                        } catch (_err) {}
                      }}
                      activeOpacity={0.8}
                    >
                      <View style={styles.modeContent}>
                        <View style={styles.modeTitleRow}>
                          <Text
                            style={[
                              styles.modeTitle,
                              isSelected && styles.modeTitleSelected,
                              isDisabled && styles.modeTitleDisabled,
                            ]}
                          >
                            {item.name}
                          </Text>
                          {item.tag && (
                            <View
                              style={[
                                styles.tagBadge,
                                isSelected && styles.tagBadgeSelected,
                                isDisabled && styles.tagBadgeDisabled,
                              ]}
                            >
                              <Text style={[styles.tagText, isDisabled && styles.tagTextDisabled]}>
                                {item.tag}
                              </Text>
                            </View>
                          )}
                        </View>
                        <Text
                          style={[
                            styles.modeDesc,
                            isDisabled && styles.modeDescDisabled,
                          ]}
                        >
                          {isDisabled ? item.disabledReason : item.description}
                        </Text>
                      </View>
                      <View
                        style={[
                          styles.radioCircle,
                          isSelected && styles.radioCircleSelected,
                          isDisabled && styles.radioCircleDisabled,
                        ]}
                      >
                        {isSelected && <CheckIcon size={12} color="#FFFFFF" />}
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              {/* Quick Manual Toggle Footer */}
              {onSwitchEngine && canSwitchToOther && (
                <View style={styles.footer}>
                  <TouchableOpacity
                    style={[styles.quickSwitchBtn, isSwitching && { opacity: 0.6 }]}
                    disabled={isSwitching}
                    onPress={() => {
                      try {
                        const nextEngine =
                          activeEngineType === ENGINE_TYPE.NATIVE ? ENGINE_TYPE.VLC : ENGINE_TYPE.NATIVE;
                        onSwitchEngine(nextEngine);
                        handleClose();
                      } catch (_err) {}
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
              )}
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
    maxWidth: 480,
    maxHeight: '94%',
    backgroundColor: '#16161A',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.4,
    shadowRadius: 15,
    elevation: 20,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  subtitle: {
    color: '#8A92A6',
    fontSize: 11.5,
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
    backgroundColor: '#0F1015',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  diagnosticDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.brand.primary,
    marginRight: 8,
  },
  diagnosticLabel: {
    color: '#8A92A6',
    fontSize: 12,
    marginRight: 6,
  },
  diagnosticValue: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  switchingBadge: {
    marginLeft: 'auto',
    backgroundColor: Colors.brand.primary,
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  modesList: {
    maxHeight: 240,
  },
  modeItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1C1D24',
    padding: 14,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  modeItemSelected: {
    borderColor: Colors.brand.primary,
    backgroundColor: 'rgba(229, 9, 20, 0.08)',
  },
  modeItemDisabled: {
    opacity: 0.5,
    backgroundColor: '#121318',
    borderColor: 'rgba(255, 255, 255, 0.04)',
  },
  modeContent: {
    flex: 1,
    paddingRight: 12,
  },
  modeTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 4,
  },
  modeTitle: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  modeTitleSelected: {
    color: '#FFFFFF',
  },
  modeTitleDisabled: {
    color: '#656A7B',
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
  tagBadgeDisabled: {
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
  },
  tagText: {
    color: '#C5C9D5',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  tagTextDisabled: {
    color: '#656A7B',
  },
  modeDesc: {
    color: '#8A92A6',
    fontSize: 12,
    lineHeight: 16,
  },
  modeDescDisabled: {
    color: '#555A6B',
  },
  radioCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: '#4A5063',
    justifyContent: 'center',
    alignItems: 'center',
  },
  radioCircleSelected: {
    borderColor: Colors.brand.primary,
    backgroundColor: Colors.brand.primary,
  },
  radioCircleDisabled: {
    borderColor: '#262D3D',
  },
  footer: {
    marginTop: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
  },
  quickSwitchBtn: {
    backgroundColor: '#262D3D',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  quickSwitchText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
});
