import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  ScrollView,
  TouchableWithoutFeedback,
} from 'react-native';
import Colors from '../constants/colors';
import {
  AudioTrackIcon,
  SubtitleTrackIcon,
  CheckIcon,
  CloseXIcon,
} from './Icons';

// Comprehensive language map for converting ISO codes to friendly display names
const LANGUAGE_NAMES = {
  en: 'English',
  eng: 'English',
  es: 'Spanish',
  spa: 'Spanish',
  fr: 'French',
  fra: 'French',
  fre: 'French',
  de: 'German',
  deu: 'German',
  ger: 'German',
  it: 'Italian',
  ita: 'Italian',
  pt: 'Portuguese',
  por: 'Portuguese',
  ru: 'Russian',
  rus: 'Russian',
  ar: 'Arabic',
  ara: 'Arabic',
  hi: 'Hindi',
  hin: 'Hindi',
  zh: 'Chinese',
  zho: 'Chinese',
  chi: 'Chinese',
  ja: 'Japanese',
  jpn: 'Japanese',
  ko: 'Korean',
  kor: 'Korean',
  tr: 'Turkish',
  tur: 'Turkish',
  pl: 'Polish',
  pol: 'Polish',
  nl: 'Dutch',
  nld: 'Dutch',
  dut: 'Dutch',
  sv: 'Swedish',
  swe: 'Swedish',
  no: 'Norwegian',
  nor: 'Norwegian',
  da: 'Danish',
  dan: 'Danish',
  fi: 'Finnish',
  fin: 'Finnish',
  el: 'Greek',
  ell: 'Greek',
  gre: 'Greek',
  ro: 'Romanian',
  ron: 'Romanian',
  rum: 'Romanian',
  cs: 'Czech',
  ces: 'Czech',
  cze: 'Czech',
  hu: 'Hungarian',
  hun: 'Hungarian',
  uk: 'Ukrainian',
  ukr: 'Ukrainian',
  und: 'Original / Default',
};

/**
 * Formats an AudioTrack or SubtitleTrack into a clean, human-readable display string.
 */
export function formatTrackDisplayLabel(track, index = 0, defaultPrefix = 'Track') {
  if (!track) return `${defaultPrefix} ${index + 1}`;

  const langCode = (track.language || '').toLowerCase().trim();
  const friendlyLang = LANGUAGE_NAMES[langCode] || (langCode ? langCode.toUpperCase() : null);

  const label = (track.label || track.name || '').trim();

  if (label && friendlyLang && !label.toLowerCase().includes(friendlyLang.toLowerCase())) {
    return `${friendlyLang} (${label})`;
  }

  if (label) {
    return label;
  }

  if (friendlyLang) {
    return friendlyLang;
  }

  return `${defaultPrefix} ${index + 1}`;
}

/**
 * Modal dialog for selecting audio and subtitle/closed-caption tracks.
 */
export default function TrackSelectionModal({
  visible = false,
  onClose,
  initialTab = 'audio',
  availableAudioTracks = [],
  selectedAudioTrack = null,
  onSelectAudioTrack,
  availableSubtitleTracks = [],
  selectedSubtitleTrack = null,
  onSelectSubtitleTrack,
}) {
  const [activeTab, setActiveTab] = useState(initialTab);

  useEffect(() => {
    if (visible) {
      setActiveTab(initialTab);
    }
  }, [visible, initialTab]);

  const audioList = useMemo(() => {
    return Array.isArray(availableAudioTracks) ? availableAudioTracks : [];
  }, [availableAudioTracks]);

  const subtitleList = useMemo(() => {
    return Array.isArray(availableSubtitleTracks) ? availableSubtitleTracks : [];
  }, [availableSubtitleTracks]);

  const isAudioTrackSelected = (track, idx) => {
    if (!selectedAudioTrack) {
      return idx === 0 && Boolean(track.isDefault);
    }
    if (track.id && selectedAudioTrack.id) {
      return track.id === selectedAudioTrack.id;
    }
    if (track.label && selectedAudioTrack.label) {
      return track.label === selectedAudioTrack.label;
    }
    if (track.language && selectedAudioTrack.language) {
      return track.language === selectedAudioTrack.language;
    }
    return track === selectedAudioTrack;
  };

  const isSubtitleTrackSelected = (track) => {
    if (!selectedSubtitleTrack) return false;
    if (track.id && selectedSubtitleTrack.id) {
      return track.id === selectedSubtitleTrack.id;
    }
    if (track.label && selectedSubtitleTrack.label) {
      return track.label === selectedSubtitleTrack.label;
    }
    if (track.language && selectedSubtitleTrack.language) {
      return track.language === selectedSubtitleTrack.language;
    }
    return track === selectedSubtitleTrack;
  };

  if (!visible) return null;

  return (
    <Modal
      transparent
      visible={visible}
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.modalBackdrop}>
          <TouchableWithoutFeedback onPress={(e) => e?.stopPropagation?.()}>
            <View style={styles.modalCard}>
              {/* Header */}
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Audio & Subtitles</Text>
                <TouchableOpacity
                  style={styles.closeBtn}
                  onPress={onClose}
                  hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                  activeOpacity={0.7}
                  accessibilityLabel="Close track selector"
                >
                  <CloseXIcon size={18} color="#94A3B8" />
                </TouchableOpacity>
              </View>

              {/* Segmented Tab Bar */}
              <View style={styles.tabBar}>
                <TouchableOpacity
                  style={[styles.tabBtn, activeTab === 'audio' && styles.tabBtnActive]}
                  onPress={() => setActiveTab('audio')}
                  activeOpacity={0.8}
                >
                  <AudioTrackIcon
                    size={16}
                    color={activeTab === 'audio' ? Colors.brand.primary : '#94A3B8'}
                  />
                  <Text
                    style={[
                      styles.tabBtnText,
                      activeTab === 'audio' && styles.tabBtnTextActive,
                    ]}
                  >
                    Audio {audioList.length > 0 ? `(${audioList.length})` : ''}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.tabBtn, activeTab === 'subtitles' && styles.tabBtnActive]}
                  onPress={() => setActiveTab('subtitles')}
                  activeOpacity={0.8}
                >
                  <SubtitleTrackIcon
                    size={16}
                    color={activeTab === 'subtitles' ? Colors.brand.primary : '#94A3B8'}
                  />
                  <Text
                    style={[
                      styles.tabBtnText,
                      activeTab === 'subtitles' && styles.tabBtnTextActive,
                    ]}
                  >
                    Subtitles {subtitleList.length > 0 ? `(${subtitleList.length})` : ''}
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Track Content */}
              <ScrollView style={styles.listContainer} bounces={false}>
                {activeTab === 'audio' ? (
                  /* Audio Tracks Tab */
                  audioList.length > 0 ? (
                    audioList.map((track, idx) => {
                      const selected = isAudioTrackSelected(track, idx);
                      const displayLabel = formatTrackDisplayLabel(track, idx, 'Audio Track');
                      return (
                        <TouchableOpacity
                          key={track.id || `${track.language}_${idx}`}
                          style={[styles.trackRow, selected && styles.trackRowSelected]}
                          onPress={() => {
                            onSelectAudioTrack?.(track);
                            onClose?.();
                          }}
                          activeOpacity={0.75}
                        >
                          <View style={styles.trackInfo}>
                            <Text
                              style={[styles.trackName, selected && styles.trackNameSelected]}
                              numberOfLines={1}
                            >
                              {displayLabel}
                            </Text>
                            {track.language ? (
                              <Text style={styles.trackCode}>
                                {String(track.language).toUpperCase()}
                              </Text>
                            ) : null}
                          </View>
                          {selected ? (
                            <View style={styles.checkCircle}>
                              <CheckIcon size={14} color={Colors.brand.primary} />
                            </View>
                          ) : null}
                        </TouchableOpacity>
                      );
                    })
                  ) : (
                    <View style={styles.emptyContainer}>
                      <View style={styles.trackRowSelected}>
                        <View style={styles.trackInfo}>
                          <Text style={styles.trackNameSelected}>Default Stream Audio</Text>
                          <Text style={styles.trackCode}>STEREO / SURROUND</Text>
                        </View>
                        <View style={styles.checkCircle}>
                          <CheckIcon size={14} color={Colors.brand.primary} />
                        </View>
                      </View>
                      <Text style={styles.emptyNote}>
                        This title contains a single embedded audio feed.
                      </Text>
                    </View>
                  )
                ) : (
                  /* Subtitles Tab */
                  <>
                    {/* Option 1: Off / Disabled */}
                    <TouchableOpacity
                      style={[
                        styles.trackRow,
                        selectedSubtitleTrack === null && styles.trackRowSelected,
                      ]}
                      onPress={() => {
                        onSelectSubtitleTrack?.(null);
                        onClose?.();
                      }}
                      activeOpacity={0.75}
                    >
                      <View style={styles.trackInfo}>
                        <Text
                          style={[
                            styles.trackName,
                            selectedSubtitleTrack === null && styles.trackNameSelected,
                          ]}
                        >
                          Off
                        </Text>
                        <Text style={styles.trackCode}>SUBTITLES DISABLED</Text>
                      </View>
                      {selectedSubtitleTrack === null ? (
                        <View style={styles.checkCircle}>
                          <CheckIcon size={14} color={Colors.brand.primary} />
                        </View>
                      ) : null}
                    </TouchableOpacity>

                    {/* Available Subtitle Tracks */}
                    {subtitleList.length > 0 ? (
                      subtitleList.map((track, idx) => {
                        const selected = isSubtitleTrackSelected(track);
                        const displayLabel = formatTrackDisplayLabel(track, idx, 'Subtitle');
                        return (
                          <TouchableOpacity
                            key={track.id || `${track.language}_${idx}`}
                            style={[styles.trackRow, selected && styles.trackRowSelected]}
                            onPress={() => {
                              onSelectSubtitleTrack?.(track);
                              onClose?.();
                            }}
                            activeOpacity={0.75}
                          >
                            <View style={styles.trackInfo}>
                              <Text
                                style={[
                                  styles.trackName,
                                  selected && styles.trackNameSelected,
                                ]}
                                numberOfLines={1}
                              >
                                {displayLabel}
                              </Text>
                              {track.language ? (
                                <Text style={styles.trackCode}>
                                  {String(track.language).toUpperCase()}
                                </Text>
                              ) : null}
                            </View>
                            {selected ? (
                              <View style={styles.checkCircle}>
                                <CheckIcon size={14} color={Colors.brand.primary} />
                              </View>
                            ) : null}
                          </TouchableOpacity>
                        );
                      })
                    ) : (
                      <View style={styles.emptyContainer}>
                        <Text style={styles.emptyNote}>
                          No additional subtitle streams were detected in this title.
                        </Text>
                      </View>
                    )}
                  </>
                )}
              </ScrollView>
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalCard: {
    width: '90%',
    maxWidth: 380,
    maxHeight: '85%',
    backgroundColor: Colors.background.secondary,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border.default,
    overflow: 'hidden',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#F8FAFC',
    letterSpacing: 0.3,
  },
  closeBtn: {
    padding: 6,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  tabBar: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
    gap: 10,
  },
  tabBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderWidth: 1,
    borderColor: 'transparent',
    gap: 8,
  },
  tabBtnActive: {
    backgroundColor: 'rgba(249, 115, 22, 0.12)',
    borderColor: Colors.brand.primary,
  },
  tabBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#94A3B8',
  },
  tabBtnTextActive: {
    color: '#F8FAFC',
    fontWeight: '700',
  },
  listContainer: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    maxHeight: 320,
  },
  trackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    marginBottom: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.04)',
  },
  trackRowSelected: {
    backgroundColor: 'rgba(249, 115, 22, 0.14)',
    borderColor: 'rgba(249, 115, 22, 0.4)',
  },
  trackInfo: {
    flex: 1,
    marginRight: 12,
  },
  trackName: {
    fontSize: 15,
    fontWeight: '500',
    color: '#E2E8F0',
    marginBottom: 2,
  },
  trackNameSelected: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  trackCode: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  checkCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(249, 115, 22, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyContainer: {
    paddingVertical: 10,
  },
  emptyNote: {
    fontSize: 13,
    color: '#64748B',
    textAlign: 'center',
    marginTop: 12,
    marginBottom: 6,
    fontStyle: 'italic',
  },
});
