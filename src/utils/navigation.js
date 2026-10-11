/**
 * Safely navigates back if there is a previous route in history;
 * otherwise navigates to the fallback route (defaulting to '/(tabs)')
 * to prevent 'The action GO_BACK was not handled by any navigator' crashes/warnings.
 */
export function safeBack(router, fallback = '/(tabs)') {
  if (!router) return;
  try {
    if (typeof router.canGoBack === 'function' && router.canGoBack()) {
      router.back();
    } else if (fallback && typeof router.replace === 'function') {
      router.replace(fallback);
    }
  } catch (_e) {
    if (fallback && typeof router.replace === 'function') {
      try {
        router.replace(fallback);
      } catch (_e2) {}
    }
  }
}
