import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Pressable,
  ScrollView,
  Animated,
  Easing,
  ActivityIndicator,
  Clipboard,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Colors from '../constants/colors';
import {
  useSubscription,
  SUBSCRIPTION_STATUS,
  formatAppExpiryDate,
  formatAppExpiryTime,
  getSubscriptionTimeRemaining,
  calculateSubscriptionProgress,
} from '../state/SubscriptionContext';
import { useApp } from '../state/AppContext';
import {
  ShieldIcon,
  ClockIcon,
  CalendarIcon,
  CheckCircleIcon,
  AlertCircleIcon,
  StarIcon,
  CloseXIcon,
  RefreshIcon,
  CopyIcon,
  CheckIcon,
} from './Icons';

/**
 * Reusable animated subscription details dialog.
 * Opens with a smooth scale and fade pop-in, displaying complete authoritative
 * subscription and expiry metadata without mock or hardcoded dates.
 */
export default function SubscriptionDetailsModal({ visible, onClose }) {
  const insets = useSafeAreaInsets();

  const {
    subscription,
    subscriptionStatus,
    subscriptionType,
    appExpiresAt,
    isSubscriptionValid,
    isTrialEligible,
    trialDurationDays,
    isActivating,
    activateTrial,
    refreshSubscription,
    isCached,
    lastValidatedAt,
    deviceId: subDeviceId,
    installationId: subInstallationId,
  } = useSubscription();

  const {
    deviceId: appDeviceId,
    installationId: appInstallationId,
  } = useApp();

  const authoritativeDeviceId = subscription?.device_id || subDeviceId || appDeviceId || 'N/A';
  const authoritativeInstallationId = subscription?.installation_id || subInstallationId || appInstallationId || null;

  // Animation values
  const [isRendered, setIsRendered] = useState(visible);
  const animVal = useRef(new Animated.Value(0)).current;
  const isClosingRef = useRef(false);

  // Local interaction states
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [copiedType, setCopiedType] = useState(null); // 'device' | 'uuid'
  const copiedTimerRef = useRef(null);

  // Trigger smooth enter or exit animation
  useEffect(() => {
    if (visible) {
      setIsRendered(true);
      isClosingRef.current = false;
      animVal.setValue(0);
      Animated.timing(animVal, {
        toValue: 1,
        duration: 260,
        easing: Easing.bezier(0.16, 1, 0.3, 1),
        useNativeDriver: true,
      }).start();
    } else if (isRendered && !isClosingRef.current) {
      isClosingRef.current = true;
      Animated.timing(animVal, {
        toValue: 0,
        duration: 200,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) {
          setIsRendered(false);
          isClosingRef.current = false;
        }
      });
    }
  }, [visible, isRendered, animVal]);

  // Clean up timers on unmount
  useEffect(() => {
    return () => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    };
  }, []);

  const handleClose = useCallback(() => {
    if (isClosingRef.current) return;
    isClosingRef.current = true;
    Animated.timing(animVal, {
      toValue: 0,
      duration: 200,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) {
        setIsRendered(false);
        isClosingRef.current = false;
        if (onClose) onClose();
      }
    });
  }, [animVal, onClose]);

  const handleRefresh = useCallback(async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    try {
      await refreshSubscription({ silent: false });
    } catch (_e) {
      // Handled in subscription context
    } finally {
      setIsRefreshing(false);
    }
  }, [isRefreshing, refreshSubscription]);

  const handleActivateTrial = useCallback(async () => {
    if (isActivating) return;
    try {
      await activateTrial();
    } catch (_e) {}
  }, [isActivating, activateTrial]);

  const handleCopy = useCallback((text, type) => {
    if (!text || text === 'N/A') return;
    try {
      if (Clipboard && Clipboard.setString) {
        Clipboard.setString(text);
        setCopiedType(type);
        if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
        copiedTimerRef.current = setTimeout(() => {
          setCopiedType(null);
        }, 2200);
      }
    } catch (_e) {}
  }, []);

  // Compute detailed status badge and presentation
  const statusDetails = useMemo(() => {
    const rawStatus = String(subscription?.status || '').toLowerCase();
    const serverTime = subscription?.server_time || null;
    const timeInfo = getSubscriptionTimeRemaining(appExpiresAt, serverTime);

    if (subscriptionStatus === SUBSCRIPTION_STATUS.CHECKING) {
      return {
        key: 'PENDING_VALIDATION',
        label: 'Pending Validation',
        color: '#60A5FA',
        badgeBg: 'rgba(96, 165, 250, 0.12)',
        borderColor: 'rgba(96, 165, 250, 0.35)',
        icon: <ActivityIndicator size="small" color="#60A5FA" style={{ transform: [{ scale: 0.75 }] }} />,
        headline: 'Validating with server...',
        subheadline: 'Connecting to authoritative subscription server',
      };
    }

    if (subscriptionStatus === SUBSCRIPTION_STATUS.BACKEND_UNAVAILABLE) {
      return {
        key: 'UNABLE_TO_VERIFY',
        label: 'Unable to Verify',
        color: '#EF4444',
        badgeBg: 'rgba(239, 68, 68, 0.12)',
        borderColor: 'rgba(239, 68, 68, 0.35)',
        icon: <AlertCircleIcon size={14} color="#EF4444" />,
        headline: 'Server Unreachable',
        subheadline: 'Could not connect to subscription verification server',
      };
    }

    if (subscriptionStatus === SUBSCRIPTION_STATUS.TRIAL_AVAILABLE) {
      return {
        key: 'TRIAL_AVAILABLE',
        label: 'Free Trial Available',
        color: '#F59E0B',
        badgeBg: 'rgba(245, 158, 11, 0.12)',
        borderColor: 'rgba(245, 158, 11, 0.35)',
        icon: <StarIcon size={14} color="#F59E0B" />,
        headline: `${trialDurationDays} Days Ready to Activate`,
        subheadline: 'Your device is eligible for a full access trial',
      };
    }

    if (rawStatus === 'disabled') {
      return {
        key: 'INACTIVE',
        label: 'Disabled by Admin',
        color: '#94A3B8',
        badgeBg: 'rgba(148, 163, 184, 0.12)',
        borderColor: 'rgba(148, 163, 184, 0.35)',
        icon: <AlertCircleIcon size={14} color="#94A3B8" />,
        headline: 'Subscription Disabled',
        subheadline: subscription?.reason || 'Access has been temporarily disabled by administrator',
      };
    }

    if (rawStatus === 'revoked') {
      return {
        key: 'INACTIVE',
        label: 'Revoked',
        color: '#EF4444',
        badgeBg: 'rgba(239, 68, 68, 0.12)',
        borderColor: 'rgba(239, 68, 68, 0.35)',
        icon: <AlertCircleIcon size={14} color="#EF4444" />,
        headline: 'Subscription Revoked',
        subheadline: subscription?.reason || 'Access has been revoked by administrator',
      };
    }

    if (subscriptionStatus === SUBSCRIPTION_STATUS.EXPIRED || !isSubscriptionValid) {
      return {
        key: 'EXPIRED',
        label: 'Expired',
        color: '#EF4444',
        badgeBg: 'rgba(239, 68, 68, 0.12)',
        borderColor: 'rgba(239, 68, 68, 0.35)',
        icon: <AlertCircleIcon size={14} color="#EF4444" />,
        headline: timeInfo.text,
        subheadline: appExpiresAt ? `Ended on ${formatAppExpiryDate(appExpiresAt, true)}` : 'Subscription period has concluded',
      };
    }

    // Active subscription (Trial or Paid)
    const isExpiringSoon = timeInfo.days <= 1;
    const isTrial = subscriptionType === 'trial';

    if (isExpiringSoon) {
      return {
        key: 'EXPIRING_SOON',
        label: 'Expiring Soon',
        color: '#F59E0B',
        badgeBg: 'rgba(245, 158, 11, 0.12)',
        borderColor: 'rgba(245, 158, 11, 0.35)',
        icon: <ClockIcon size={14} color="#F59E0B" />,
        headline: timeInfo.text,
        subheadline: `Expires ${formatAppExpiryDate(appExpiresAt, true)}`,
      };
    }

    if (isTrial) {
      return {
        key: 'TRIAL_ACTIVE',
        label: 'Trial Active',
        color: '#10B981',
        badgeBg: 'rgba(16, 185, 129, 0.12)',
        borderColor: 'rgba(16, 185, 129, 0.35)',
        icon: <CheckCircleIcon size={14} color="#10B981" />,
        headline: timeInfo.text,
        subheadline: `Valid until ${formatAppExpiryDate(appExpiresAt, false)}`,
      };
    }

    return {
      key: 'ACTIVE',
      label: 'Active',
      color: '#10B981',
      badgeBg: 'rgba(16, 185, 129, 0.12)',
      borderColor: 'rgba(16, 185, 129, 0.35)',
      icon: <CheckCircleIcon size={14} color="#10B981" />,
      headline: timeInfo.text,
      subheadline: `Valid until ${formatAppExpiryDate(appExpiresAt, false)}`,
    };
  }, [subscription, subscriptionStatus, subscriptionType, appExpiresAt, isSubscriptionValid, trialDurationDays]);

  // Calculate validity progress (clamped 0–100%)
  const progressInfo = useMemo(() => {
    if (!subscription?.starts_at || !subscription?.expires_at) return null;
    return calculateSubscriptionProgress(
      subscription.starts_at,
      subscription.expires_at,
      subscription.server_time || null
    );
  }, [subscription]);

  // Formatted date and time strings
  const formattedExpiryDate = useMemo(() => {
    if (!appExpiresAt) return 'Expiry date unavailable';
    return formatAppExpiryDate(appExpiresAt, false);
  }, [appExpiresAt]);

  const formattedExpiryTime = useMemo(() => {
    if (!appExpiresAt) return null;
    return formatAppExpiryTime(appExpiresAt);
  }, [appExpiresAt]);

  const formattedActivationDate = useMemo(() => {
    if (!subscription?.starts_at) return 'N/A';
    return formatAppExpiryDate(subscription.starts_at, true);
  }, [subscription]);

  const planName = useMemo(() => {
    if (subscriptionType === 'trial') return 'Fox Player 7-Day Free Trial';
    if (subscriptionType === 'paid') return 'Fox Player Full Access';
    if (isTrialEligible) return 'Fox Player Eligible Free Trial';
    return 'Fox Player Standard';
  }, [subscriptionType, isTrialEligible]);

  const subscriptionTypeName = useMemo(() => {
    if (subscriptionType === 'trial') return 'Free Trial';
    if (subscriptionType === 'paid') return 'Paid Subscription';
    if (isTrialEligible) return 'Free Trial Offer';
    return 'None';
  }, [subscriptionType, isTrialEligible]);

  const subscriptionReference = useMemo(() => {
    if (subscription?.id) return `#${subscription.id}`;
    if (subscription?.subscription_id) return `#${subscription.subscription_id}`;
    return 'N/A';
  }, [subscription]);

  const lastValidationDisplay = useMemo(() => {
    if (lastValidatedAt) return formatAppExpiryDate(lastValidatedAt, true);
    if (subscription?.server_time) return formatAppExpiryDate(subscription.server_time, true);
    return 'Authoritative Server Clock';
  }, [lastValidatedAt, subscription]);

  if (!isRendered) return null;

  const overlayOpacity = animVal.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 1],
  });

  const cardScale = animVal.interpolate({
    inputRange: [0, 1],
    outputRange: [0.92, 1],
  });

  const cardOpacity = animVal.interpolate({
    inputRange: [0, 0.35, 1],
    outputRange: [0, 0.7, 1],
  });

  const cardTranslateY = animVal.interpolate({
    inputRange: [0, 1],
    outputRange: [14, 0],
  });

  return (
    <Modal
      visible={true}
      transparent={true}
      animationType="none"
      statusBarTranslucent={true}
      supportedOrientations={['landscape', 'landscape-left', 'landscape-right', 'portrait', 'portrait-upside-down']}
      onRequestClose={handleClose}
    >
      <View style={styles.modalRoot} pointerEvents="box-none">
        {/* Animated Semi-Transparent Background Overlay */}
        <Animated.View
          style={[
            styles.backdrop,
            { opacity: overlayOpacity },
          ]}
        >
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={handleClose}
            accessibilityRole="button"
            accessibilityLabel="Close subscription details dialog"
          />
        </Animated.View>

        {/* Dialog Centering Container */}
        <View
          style={[
            styles.container,
            {
              paddingTop: Math.max(insets.top, 12),
              paddingBottom: Math.max(insets.bottom, 12),
              paddingLeft: Math.max(insets.left, 16),
              paddingRight: Math.max(insets.right, 16),
            },
          ]}
          pointerEvents="box-none"
        >
          {/* Animated Dialog Card */}
          <Animated.View
            style={[
              styles.card,
              {
                opacity: cardOpacity,
                transform: [
                  { scale: cardScale },
                  { translateY: cardTranslateY },
                ],
              },
            ]}
          >
            {/* Header */}
            <View style={styles.headerRow}>
              <View style={styles.headerLeft}>
                <View style={styles.headerIconWrapper}>
                  <ShieldIcon size={20} color={Colors.brand.primary} />
                </View>
                <View style={styles.headerTextCol}>
                  <Text style={styles.headerTitle}>Subscription Details</Text>
                  <Text style={styles.headerSubtitle}>Your app access and expiry information</Text>
                </View>
              </View>

              <TouchableOpacity
                style={styles.closeBtn}
                onPress={handleClose}
                activeOpacity={0.7}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                accessibilityRole="button"
                accessibilityLabel="Close"
              >
                <CloseXIcon size={16} color="#CBD5E1" />
              </TouchableOpacity>
            </View>

            {/* Scrollable Body to Guarantee No Clipping on Small/Landscape Displays */}
            <ScrollView
              style={styles.scrollArea}
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator={false}
              bounces={false}
            >
              {/* Cached Offline Banner if Applicable */}
              {isCached && (
                <View style={styles.cachedBanner}>
                  <AlertCircleIcon size={14} color="#F59E0B" />
                  <Text style={styles.cachedBannerText}>
                    Showing cached subscription details. Could not reach server to verify live.
                  </Text>
                </View>
              )}

              {/* Hero Status & Expiry Banner */}
              <View style={styles.heroBanner}>
                <View style={styles.heroTopRow}>
                  <View
                    style={[
                      styles.statusBadge,
                      {
                        backgroundColor: statusDetails.badgeBg,
                        borderColor: statusDetails.borderColor,
                      },
                    ]}
                  >
                    {statusDetails.icon}
                    <Text style={[styles.statusBadgeText, { color: statusDetails.color }]}>
                      {statusDetails.label}
                    </Text>
                  </View>

                  <Text style={styles.heroLabel}>REMAINING VALIDITY</Text>
                </View>

                {/* Big Time Remaining Text */}
                <Text
                  style={[
                    styles.heroTimeRemaining,
                    statusDetails.key === 'EXPIRED' && styles.heroTextExpired,
                    statusDetails.key === 'EXPIRING_SOON' && styles.heroTextWarning,
                  ]}
                  numberOfLines={1}
                  adjustsFontSizeToFit={true}
                >
                  {statusDetails.headline}
                </Text>

                <Text style={styles.heroSubheadline} numberOfLines={1}>
                  {statusDetails.subheadline}
                </Text>

                {/* Optional Validity Progress Bar */}
                {progressInfo && (
                  <View style={styles.progressContainer}>
                    <View style={styles.progressTrack}>
                      <View
                        style={[
                          styles.progressFill,
                          {
                            width: `${progressInfo.percentage}%`,
                            backgroundColor: progressInfo.isExpired
                              ? '#EF4444'
                              : statusDetails.key === 'EXPIRING_SOON'
                              ? '#F59E0B'
                              : Colors.brand.primary,
                          },
                        ]}
                      />
                    </View>
                    <View style={styles.progressLabelsRow}>
                      <Text style={styles.progressLabel}>
                        {progressInfo.isExpired
                          ? 'Period concluded'
                          : `Elapsed: ${progressInfo.elapsedDays} of ${progressInfo.totalDays} days`}
                      </Text>
                      <Text style={styles.progressLabel}>
                        {progressInfo.isExpired ? '100% elapsed' : `${progressInfo.percentage}% elapsed`}
                      </Text>
                    </View>
                  </View>
                )}
              </View>

              {/* Expiry Timestamp Focus Cards */}
              <View style={styles.expiryGrid}>
                <View style={styles.expiryCard}>
                  <View style={styles.expiryCardIconWrapper}>
                    <CalendarIcon size={15} color={Colors.brand.primary} />
                  </View>
                  <View style={styles.expiryCardTextCol}>
                    <Text style={styles.metaLabel}>EXPIRY DATE</Text>
                    <Text style={styles.expiryCardValue} numberOfLines={1}>
                      {formattedExpiryDate}
                    </Text>
                  </View>
                </View>

                <View style={styles.expiryCard}>
                  <View style={styles.expiryCardIconWrapper}>
                    <ClockIcon size={15} color={Colors.brand.primary} />
                  </View>
                  <View style={styles.expiryCardTextCol}>
                    <Text style={styles.metaLabel}>EXPIRY TIME</Text>
                    <Text style={styles.expiryCardValue} numberOfLines={1}>
                      {formattedExpiryTime ? `${formattedExpiryTime} (Local)` : 'N/A'}
                    </Text>
                  </View>
                </View>
              </View>

              {/* Complete Subscription Metadata Grid */}
              <View style={styles.sectionCard}>
                <Text style={styles.sectionTitle}>SUBSCRIPTION INFORMATION</Text>

                <View style={styles.metaRow}>
                  <Text style={styles.metaLabel}>Plan Name</Text>
                  <Text style={styles.metaValueBold}>{planName}</Text>
                </View>

                <View style={styles.metaRow}>
                  <Text style={styles.metaLabel}>Subscription Type</Text>
                  <Text style={styles.metaValue}>{subscriptionTypeName}</Text>
                </View>

                <View style={styles.metaRow}>
                  <Text style={styles.metaLabel}>Activation Date</Text>
                  <Text style={styles.metaValue}>{formattedActivationDate}</Text>
                </View>

                <View style={styles.metaRow}>
                  <Text style={styles.metaLabel}>Subscription Reference</Text>
                  <Text style={styles.metaValueMono}>{subscriptionReference}</Text>
                </View>

                <View style={styles.metaRow}>
                  <Text style={styles.metaLabel}>Last Server Validation</Text>
                  <Text style={styles.metaValue}>{lastValidationDisplay}</Text>
                </View>

                <View style={[styles.metaRow, { borderBottomWidth: 0 }]}>
                  <Text style={styles.metaLabel}>Validation Status</Text>
                  <View style={styles.validationRow}>
                    <View
                      style={[
                        styles.validationDot,
                        { backgroundColor: isSubscriptionValid ? Colors.status.success : '#EF4444' },
                      ]}
                    />
                    <Text
                      style={[
                        styles.metaValueBold,
                        { color: isSubscriptionValid ? Colors.status.success : '#EF4444' },
                      ]}
                    >
                      {isSubscriptionValid ? 'Verified by Server' : 'Inactive / Expired'}
                    </Text>
                  </View>
                </View>
              </View>

              {/* Authoritative Device Identity Box */}
              <View style={styles.sectionCard}>
                <Text style={styles.sectionTitle}>DEVICE IDENTIFICATION</Text>

                {/* Device ID */}
                <View style={styles.deviceIdRow}>
                  <View style={styles.deviceTextCol}>
                    <Text style={styles.metaLabel}>DEVICE ID</Text>
                    <Text style={styles.deviceIdValue}>{authoritativeDeviceId}</Text>
                  </View>
                  <TouchableOpacity
                    style={[styles.copyBtn, copiedType === 'device' && styles.copyBtnActive]}
                    onPress={() => handleCopy(authoritativeDeviceId, 'device')}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel="Copy Device ID"
                  >
                    {copiedType === 'device' ? (
                      <>
                        <CheckIcon size={12} color={Colors.status.success} />
                        <Text style={[styles.copyBtnText, { color: Colors.status.success }]}>COPIED</Text>
                      </>
                    ) : (
                      <>
                        <CopyIcon size={12} color="#CBD5E1" />
                        <Text style={styles.copyBtnText}>COPY</Text>
                      </>
                    )}
                  </TouchableOpacity>
                </View>

                {/* Installation UUID (if present) */}
                {authoritativeInstallationId && (
                  <View style={[styles.deviceIdRow, { borderTopWidth: 1, borderTopColor: 'rgba(255, 255, 255, 0.06)' }]}>
                    <View style={styles.deviceTextCol}>
                      <Text style={styles.metaLabel}>INSTALLATION UUID</Text>
                      <Text style={styles.uuidValue} numberOfLines={1} ellipsizeMode="middle">
                        {authoritativeInstallationId}
                      </Text>
                    </View>
                    <TouchableOpacity
                      style={[styles.copyBtn, copiedType === 'uuid' && styles.copyBtnActive]}
                      onPress={() => handleCopy(authoritativeInstallationId, 'uuid')}
                      activeOpacity={0.7}
                      accessibilityRole="button"
                      accessibilityLabel="Copy Installation UUID"
                    >
                      {copiedType === 'uuid' ? (
                        <>
                          <CheckIcon size={12} color={Colors.status.success} />
                          <Text style={[styles.copyBtnText, { color: Colors.status.success }]}>COPIED</Text>
                        </>
                      ) : (
                        <>
                          <CopyIcon size={12} color="#CBD5E1" />
                          <Text style={styles.copyBtnText}>COPY</Text>
                        </>
                      )}
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            </ScrollView>

            {/* Action Buttons Footer */}
            <View style={styles.footerRow}>
              {/* Left action: Refresh status from server */}
              <TouchableOpacity
                style={styles.refreshActionBtn}
                onPress={handleRefresh}
                disabled={isRefreshing}
                activeOpacity={0.75}
                accessibilityRole="button"
                accessibilityLabel="Check server subscription status"
              >
                {isRefreshing ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <>
                    <RefreshIcon size={14} color="#CBD5E1" />
                    <Text style={styles.refreshActionBtnText}>Refresh Status</Text>
                  </>
                )}
              </TouchableOpacity>

              {/* Special action if trial is available */}
              {isTrialEligible && !isSubscriptionValid ? (
                <TouchableOpacity
                  style={[styles.primaryActionBtn, isActivating && styles.btnDisabled]}
                  onPress={handleActivateTrial}
                  disabled={isActivating}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                  accessibilityLabel="Activate Free Trial"
                >
                  {isActivating ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Text style={styles.primaryActionBtnText}>Activate Free Trial</Text>
                  )}
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={styles.doneBtn}
                  onPress={handleClose}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                  accessibilityLabel="Done"
                >
                  <Text style={styles.doneBtnText}>Done</Text>
                </TouchableOpacity>
              )}
            </View>
          </Animated.View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalRoot: {
    flex: 1,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(5, 7, 12, 0.88)',
  },
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  card: {
    width: '90%',
    maxWidth: 380,
    maxHeight: '92%',
    backgroundColor: Colors.background.secondary,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border.default,
    overflow: 'hidden',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border.subtle,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  headerIconWrapper: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: 'rgba(249, 115, 22, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(249, 115, 22, 0.28)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTextCol: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.2,
  },
  headerSubtitle: {
    fontSize: 11.5,
    fontWeight: '500',
    color: '#94A3B8',
    marginTop: 1,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 10,
  },
  scrollArea: {
    maxHeight: 460,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingVertical: 14,
    gap: 12,
  },
  cachedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.3)',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
  },
  cachedBannerText: {
    fontSize: 11.5,
    color: '#F59E0B',
    fontWeight: '500',
    flex: 1,
    lineHeight: 16,
  },
  heroBanner: {
    backgroundColor: '#161E2E',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#232E44',
    padding: 14,
    gap: 6,
  },
  heroTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    gap: 6,
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  heroLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#64748B',
    letterSpacing: 0.8,
  },
  heroTimeRemaining: {
    fontSize: 22,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: -0.3,
  },
  heroTextExpired: {
    color: '#EF4444',
  },
  heroTextWarning: {
    color: '#F59E0B',
  },
  heroSubheadline: {
    fontSize: 12,
    fontWeight: '500',
    color: '#94A3B8',
  },
  progressContainer: {
    marginTop: 8,
    gap: 4,
  },
  progressTrack: {
    width: '100%',
    height: 5,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
  },
  progressLabelsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  progressLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: '#64748B',
  },
  expiryGrid: {
    flexDirection: 'row',
    gap: 10,
  },
  expiryCard: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#161E2E',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#232E44',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 10,
  },
  expiryCardIconWrapper: {
    width: 28,
    height: 28,
    borderRadius: 7,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  expiryCardTextCol: {
    flex: 1,
  },
  expiryCardValue: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#FFFFFF',
    marginTop: 2,
  },
  sectionCard: {
    backgroundColor: '#161E2E',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#232E44',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  sectionTitle: {
    fontSize: 10,
    fontWeight: '800',
    color: '#64748B',
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.05)',
  },
  metaLabel: {
    fontSize: 11.5,
    fontWeight: '500',
    color: '#94A3B8',
  },
  metaValue: {
    fontSize: 12,
    fontWeight: '600',
    color: '#E2E8F0',
  },
  metaValueBold: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  metaValueMono: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#E2E8F0',
    fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
  },
  validationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  validationDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  deviceIdRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 7,
    gap: 10,
  },
  deviceTextCol: {
    flex: 1,
  },
  deviceIdValue: {
    fontSize: 13,
    fontWeight: '800',
    color: '#FFFFFF',
    fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
    letterSpacing: 1,
    marginTop: 2,
  },
  uuidValue: {
    fontSize: 11,
    fontWeight: '600',
    color: '#CBD5E1',
    fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
    marginTop: 2,
  },
  copyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  copyBtnActive: {
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    borderColor: 'rgba(16, 185, 129, 0.3)',
  },
  copyBtnText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#CBD5E1',
    letterSpacing: 0.5,
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.border.subtle,
    gap: 8,
  },
  refreshActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: Colors.border.default,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 9,
    justifyContent: 'center',
  },
  refreshActionBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.text.secondary,
  },
  doneBtn: {
    flex: 1,
    backgroundColor: Colors.brand.primary,
    borderRadius: 8,
    paddingVertical: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#000000',
  },
  primaryActionBtn: {
    flex: 1,
    backgroundColor: Colors.brand.primary,
    borderRadius: 8,
    paddingVertical: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryActionBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#000000',
  },
  btnDisabled: {
    opacity: 0.6,
  },
});
