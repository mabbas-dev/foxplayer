import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Image,
  ScrollView,
  Modal,
  Platform,
  Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Colors from '../constants/colors';
import { useSubscription, SUBSCRIPTION_STATUS } from '../state/SubscriptionContext';
import { CheckCircleIcon, AlertCircleIcon, CalendarIcon, TvPlayIcon, StarIcon } from './Icons';

export default function FreeTrialDisclaimerModal() {
  const {
    showTrialDisclaimer,
    isTrialEligible,
    trialDurationDays,
    isActivating,
    error,
    activateTrial,
    dismissTrialDisclaimer,
    subscriptionStatus,
  } = useSubscription();

  const insets = useSafeAreaInsets();

  // Only render when trial is eligible, disclaimer is triggered, and trial is available
  if (!showTrialDisclaimer || !isTrialEligible || subscriptionStatus === SUBSCRIPTION_STATUS.ACTIVE_TRIAL || subscriptionStatus === SUBSCRIPTION_STATUS.ACTIVE_PAID) {
    return null;
  }

  const handleActivate = async () => {
    if (isActivating) return;
    await activateTrial();
  };

  const handleDismiss = () => {
    if (isActivating) return;
    dismissTrialDisclaimer();
  };

  return (
    <Modal
      visible={true}
      transparent={true}
      animationType="fade"
      statusBarTranslucent={true}
      supportedOrientations={['landscape', 'landscape-left', 'landscape-right']}
      onRequestClose={handleDismiss}
    >
      <View style={styles.overlay}>
        <View
          style={[
            styles.modalContainer,
            {
              paddingTop: Math.max(insets.top, 16),
              paddingBottom: Math.max(insets.bottom, 16),
              paddingLeft: Math.max(insets.left, 20),
              paddingRight: Math.max(insets.right, 20),
            },
          ]}
        >
          <View style={styles.card}>
            <ScrollView
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator={false}
              bounces={false}
            >
              {/* Header: Logo & Badge */}
              <View style={styles.headerRow}>
                <Image
                  source={require('../../assets/inside-app-logo.png')}
                  style={styles.logo}
                  resizeMode="contain"
                />
                <View style={styles.offerBadge}>
                  <StarIcon size={12} color="#F59E0B" />
                  <Text style={styles.offerBadgeText}>SPECIAL OFFER</Text>
                </View>
              </View>

              {/* Title & Description */}
              <Text style={styles.title}>Your Free Trial Is Available</Text>
              <Text style={styles.description}>
                Your device is eligible for a limited free trial of Fox Player. Your trial period starts and expires according to the subscription details confirmed by our server.
              </Text>

              {/* Server-Confirmed Details Grid */}
              <View style={styles.detailsGrid}>
                <View style={styles.detailBox}>
                  <Text style={styles.detailBoxLabel}>TRIAL STATUS</Text>
                  <View style={styles.statusRow}>
                    <View style={styles.statusDot} />
                    <Text style={styles.detailBoxValueActive}>Available</Text>
                  </View>
                </View>

                <View style={styles.detailBox}>
                  <Text style={styles.detailBoxLabel}>DURATION</Text>
                  <Text style={styles.detailBoxValue}>{trialDurationDays} Days</Text>
                </View>

                <View style={styles.detailBox}>
                  <Text style={styles.detailBoxLabel}>APP EXPIRY</Text>
                  <Text style={styles.detailBoxValueSubtle}>Starts upon activation</Text>
                </View>
              </View>

              {/* Value Proposition Highlights */}
              <View style={styles.highlightsContainer}>
                <View style={styles.highlightRow}>
                  <CheckCircleIcon size={14} color={Colors.status.success} />
                  <Text style={styles.highlightText}>
                    Full access to Live TV, Movies, Series, and multi-playlist management
                  </Text>
                </View>
                <View style={styles.highlightRow}>
                  <CheckCircleIcon size={14} color={Colors.status.success} />
                  <Text style={styles.highlightText}>
                    Authoritative server-timed access with zero surprise renewal fees
                  </Text>
                </View>
              </View>

              {/* Error Message if Activation Failed */}
              {error ? (
                <View style={styles.errorContainer}>
                  <AlertCircleIcon size={16} color={Colors.status.error} />
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              ) : null}

              {/* Action Buttons */}
              <View style={styles.actionsRow}>
                <TouchableOpacity
                  style={[styles.primaryButton, isActivating && styles.buttonDisabled]}
                  onPress={handleActivate}
                  disabled={isActivating}
                  activeOpacity={0.8}
                  accessibilityLabel="Activate Free Trial"
                  accessibilityRole="button"
                >
                  {isActivating ? (
                    <View style={styles.loadingRow}>
                      <ActivityIndicator size="small" color="#FFFFFF" />
                      <Text style={styles.primaryButtonText}>Activating Trial...</Text>
                    </View>
                  ) : (
                    <Text style={styles.primaryButtonText}>Activate Free Trial</Text>
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.secondaryButton, isActivating && styles.buttonDisabled]}
                  onPress={handleDismiss}
                  disabled={isActivating}
                  activeOpacity={0.7}
                  accessibilityLabel="Not Now"
                  accessibilityRole="button"
                >
                  <Text style={styles.secondaryButtonText}>Not Now</Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.footerNote}>
                You can also activate your trial later in Settings. Device identity is verified with our server.
              </Text>
            </ScrollView>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(5, 7, 12, 0.92)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContainer: {
    width: '100%',
    maxWidth: 640,
    justifyContent: 'center',
    alignItems: 'center',
  },
  card: {
    width: '100%',
    backgroundColor: '#0F1420',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#263147',
    paddingHorizontal: 24,
    paddingVertical: 20,
    maxHeight: '92%',
    ...Platform.select({
      ios: {
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.6,
        shadowRadius: 18,
      },
      android: {
        elevation: 12,
      },
    }),
  },
  scrollContent: {
    alignItems: 'center',
    paddingBottom: 4,
  },
  headerRow: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  logo: {
    width: 110,
    height: 32,
  },
  offerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.3)',
    gap: 5,
  },
  offerBadgeText: {
    color: '#F59E0B',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 8,
    letterSpacing: -0.3,
  },
  description: {
    color: '#94A3B8',
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
    marginBottom: 16,
    paddingHorizontal: 16,
  },
  detailsGrid: {
    width: '100%',
    flexDirection: 'row',
    gap: 10,
    marginBottom: 16,
  },
  detailBox: {
    flex: 1,
    backgroundColor: '#161E2E',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#232E44',
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignItems: 'center',
  },
  detailBoxLabel: {
    color: '#64748B',
    fontSize: 10,
    fontWeight: '600',
    marginBottom: 4,
    letterSpacing: 0.6,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: Colors.status.success,
  },
  detailBoxValueActive: {
    color: Colors.status.success,
    fontSize: 13,
    fontWeight: '700',
  },
  detailBoxValue: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  detailBoxValueSubtle: {
    color: '#CBD5E1',
    fontSize: 11,
    fontWeight: '500',
    textAlign: 'center',
  },
  highlightsContainer: {
    width: '100%',
    backgroundColor: 'rgba(30, 41, 59, 0.45)',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginBottom: 16,
    gap: 8,
  },
  highlightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  highlightText: {
    color: '#CBD5E1',
    fontSize: 12,
    flex: 1,
  },
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    borderColor: 'rgba(239, 68, 68, 0.3)',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 14,
    gap: 8,
    width: '100%',
  },
  errorText: {
    color: Colors.status.error,
    fontSize: 12,
    flex: 1,
  },
  actionsRow: {
    flexDirection: 'row',
    width: '100%',
    gap: 12,
    marginBottom: 10,
  },
  primaryButton: {
    flex: 1.6,
    backgroundColor: Colors.brand.primary,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButton: {
    flex: 1,
    backgroundColor: '#1E293B',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#334155',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  secondaryButtonText: {
    color: '#94A3B8',
    fontSize: 13,
    fontWeight: '600',
  },
  footerNote: {
    color: '#64748B',
    fontSize: 10.5,
    textAlign: 'center',
    marginTop: 4,
  },
});
