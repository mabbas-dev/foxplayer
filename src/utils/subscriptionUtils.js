/**
 * Authoritative subscription and expiry calculation & formatting utilities.
 * Pure JavaScript helpers without JSX dependencies for complete testability and cross-platform consistency.
 */

/**
 * Format an authoritative ISO UTC date string in the user's local timezone.
 */
export function formatAppExpiryDate(isoString, includeTime = false) {
  if (!isoString) return 'N/A';
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return 'N/A';
    
    const options = {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      ...(includeTime ? { hour: '2-digit', minute: '2-digit' } : {}),
    };
    return includeTime ? d.toLocaleString(undefined, options) : d.toLocaleDateString(undefined, options);
  } catch (_e) {
    return 'N/A';
  }
}

/**
 * Format local time from ISO timestamp.
 */
export function formatAppExpiryTime(isoString) {
  if (!isoString) return 'N/A';
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return 'N/A';
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  } catch (_e) {
    return 'N/A';
  }
}

/**
 * Accurately calculate human-readable remaining or elapsed subscription duration
 * against authoritative server time (or client clock if server time unavailable).
 */
export function getSubscriptionTimeRemaining(expiresAt, serverTime = null) {
  if (!expiresAt) {
    return {
      text: 'Expiry date unavailable',
      isExpired: false,
      remainingMs: 0,
      days: 0,
      hours: 0,
      minutes: 0,
    };
  }

  const expDate = new Date(expiresAt);
  if (isNaN(expDate.getTime())) {
    return {
      text: 'Expiry date unavailable',
      isExpired: false,
      remainingMs: 0,
      days: 0,
      hours: 0,
      minutes: 0,
    };
  }

  const nowMs = serverTime ? new Date(serverTime).getTime() : Date.now();
  const diffMs = expDate.getTime() - nowMs;

  if (diffMs <= 0) {
    const elapsedMs = Math.abs(diffMs);
    const elapsedDays = Math.floor(elapsedMs / (24 * 3600 * 1000));
    const elapsedHours = Math.floor((elapsedMs % (24 * 3600 * 1000)) / (3600 * 1000));
    const elapsedMinutes = Math.floor((elapsedMs % (3600 * 1000)) / (60 * 1000));

    let text;
    if (elapsedDays === 0) {
      if (elapsedHours === 0) {
        text = elapsedMinutes <= 1 ? 'Expired just now' : `Expired ${elapsedMinutes} mins ago`;
      } else {
        text = `Expired ${elapsedHours} hour${elapsedHours !== 1 ? 's' : ''} ago`;
      }
    } else if (elapsedDays === 1) {
      text = 'Expired 1 day ago';
    } else {
      text = `Expired ${elapsedDays} days ago`;
    }

    return {
      text,
      isExpired: true,
      remainingMs: diffMs,
      days: 0,
      hours: 0,
      minutes: 0,
      elapsedDays,
      elapsedHours,
    };
  }

  const days = Math.floor(diffMs / (24 * 3600 * 1000));
  const hours = Math.floor((diffMs % (24 * 3600 * 1000)) / (3600 * 1000));
  const minutes = Math.floor((diffMs % (3600 * 1000)) / (60 * 1000));

  let text;
  if (days > 2) {
    text = `${days} days remaining`;
  } else if (days >= 1) {
    text = `${days} day${days > 1 ? 's' : ''}${hours > 0 ? `, ${hours} hour${hours !== 1 ? 's' : ''}` : ''} remaining`;
  } else if (hours > 0) {
    text = `${hours} hour${hours !== 1 ? 's' : ''}, ${minutes} min remaining`;
  } else if (minutes > 0) {
    text = `Expires in ${minutes} minute${minutes !== 1 ? 's' : ''}`;
  } else {
    text = 'Expires today';
  }

  return {
    text,
    isExpired: false,
    remainingMs: diffMs,
    days,
    hours,
    minutes,
  };
}

/**
 * Calculate clamped 0–100% subscription progress between start and expiry timestamps.
 */
export function calculateSubscriptionProgress(startsAt, expiresAt, serverTime = null) {
  if (!startsAt || !expiresAt) return null;
  const startMs = new Date(startsAt).getTime();
  const endMs = new Date(expiresAt).getTime();
  const nowMs = serverTime ? new Date(serverTime).getTime() : Date.now();

  if (isNaN(startMs) || isNaN(endMs) || endMs <= startMs) return null;

  const total = endMs - startMs;
  const elapsed = nowMs - startMs;
  const progressRatio = Math.max(0, Math.min(1, elapsed / total));
  const isExpired = nowMs >= endMs;

  const elapsedDays = Math.max(0, Math.floor(elapsed / (24 * 3600 * 1000)));
  const totalDays = Math.max(1, Math.round(total / (24 * 3600 * 1000)));

  return {
    percentage: Math.round(progressRatio * 100),
    ratio: progressRatio,
    isExpired,
    elapsedDays,
    totalDays,
  };
}
