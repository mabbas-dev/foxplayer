import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Image,
  Clipboard,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import Colors from '../constants/colors';
import { useApp } from '../state/AppContext';

export default function SubscriptionExpiredBarrier() {
  const {
    isSubscriptionValid,
    isInitialized,
    subscription,
    isTrialEligible,
    deviceId,
    installationId,
    refreshSubscription,
  } = useApp();

  const router = useRouter();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [copied, setCopied] = useState(false);

  // Only render when initialized and backend subscription is strictly invalid (and not eligible for fresh trial)
  if (!isInitialized || isSubscriptionValid !== false || (isTrialEligible && !subscription)) {
    return null;
  }

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await refreshSubscription();
    } catch (_e) {} finally {
      setIsRefreshing(false);
    }
  };

  const handleCopyUuid = () => {
    if (installationId) {
      if (Clipboard && Clipboard.setString) {
        Clipboard.setString(installationId);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    }
  };

  const statusText = subscription?.status ? subscription.status.toUpperCase() : 'EXPIRED';
  const reasonText = subscription?.reason || 'Your 7-day free trial on this installation has concluded.';
  const expiresFormatted = subscription?.expires_at ? new Date(subscription.expires_at).toLocaleString() : 'N/A';

  return (
    <View style={styles.barrierContainer} pointerEvents="auto">
      <View style={styles.barrierCard}>
        {/* Logo & Header */}
        <Image
          source={require('../../assets/inside-app-logo.png')}
          style={styles.logo}
          resizeMode="contain"
        />

        <View style={styles.statusBadgeContainer}>
          <Text style={styles.statusBadgeText}>{statusText}</Text>
        </View>

        <Text style={styles.barrierTitle}>Device Subscription Inactive</Text>
        <Text style={styles.barrierSubtitle}>
          {reasonText} The backend server is the authoritative source of truth for device authorizations.
        </Text>

        {/* Identity & Timestamps Box */}
        <View style={styles.detailsBox}>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>DEVICE ID</Text>
            <Text style={styles.detailValueBold}>{deviceId || 'UNKNOWN'}</Text>
          </View>

          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>INSTALLATION UUID</Text>
            <TouchableOpacity onPress={handleCopyUuid} activeOpacity={0.7} style={styles.copyRow}>
              <Text style={styles.detailValueMono} numberOfLines={1}>
                {installationId || 'Not Registered'}
              </Text>
              <Text style={styles.copyButtonText}>{copied ? 'COPIED!' : 'COPY'}</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>EXPIRATION (UTC)</Text>
            <Text style={styles.detailValue}>{expiresFormatted}</Text>
          </View>
        </View>

        {/* Action Buttons */}
        <View style={styles.actionsContainer}>
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={handleRefresh}
            disabled={isRefreshing}
            activeOpacity={0.8}
          >
            {isRefreshing ? (
              <ActivityIndicator color="#FFFFFF" size="small" />
            ) : (
              <Text style={styles.primaryButtonText}>Check Subscription Status</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={() => router.push('/settings')}
            activeOpacity={0.8}
          >
            <Text style={styles.secondaryButtonText}>App Settings</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.footerNote}>
          To extend or activate this device, provide your Installation UUID to your IPTV administrator.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  barrierContainer: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(8, 10, 15, 0.96)',
    zIndex: 9999,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  barrierCard: {
    backgroundColor: '#161C26',
    borderWidth: 1,
    borderColor: 'rgba(232, 50, 26, 0.35)',
    borderRadius: 20,
    padding: 28,
    width: '100%',
    maxWidth: 520,
    alignItems: 'center',
    shadowColor: '#E8321A',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 24,
    elevation: 12,
  },
  logo: {
    width: 140,
    height: 38,
    marginBottom: 16,
  },
  statusBadgeContainer: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.4)',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 6,
    marginBottom: 12,
  },
  statusBadgeText: {
    color: '#EF4444',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.5,
  },
  barrierTitle: {
    color: '#F0F2F5',
    fontSize: 22,
    fontWeight: '900',
    textAlign: 'center',
    marginBottom: 8,
  },
  barrierSubtitle: {
    color: '#9BA3B2',
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
    marginBottom: 20,
    paddingHorizontal: 8,
  },
  detailsBox: {
    width: '100%',
    backgroundColor: '#0D1117',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 12,
    padding: 14,
    marginBottom: 20,
    gap: 10,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  detailLabel: {
    color: '#5C6370',
    fontSize: 10.5,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  detailValue: {
    color: '#9BA3B2',
    fontSize: 12,
  },
  detailValueBold: {
    color: '#F0F2F5',
    fontSize: 13,
    fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
    fontWeight: '800',
    letterSpacing: 1,
  },
  detailValueMono: {
    color: '#E2E8F0',
    fontSize: 11,
    fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
    maxWidth: 200,
  },
  copyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  copyButtonText: {
    color: Colors.brand.primary,
    fontSize: 10,
    fontWeight: '800',
  },
  actionsContainer: {
    width: '100%',
    gap: 10,
    marginBottom: 14,
  },
  primaryButton: {
    backgroundColor: Colors.brand.primary,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  secondaryButton: {
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    paddingVertical: 11,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: {
    color: '#9BA3B2',
    fontSize: 13,
    fontWeight: '700',
  },
  footerNote: {
    color: '#5C6370',
    fontSize: 11,
    textAlign: 'center',
    lineHeight: 15,
  },
});
