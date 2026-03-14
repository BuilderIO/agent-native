/**
 * Utility to reset a composition's localStorage data back to registry defaults.
 * Call this from browser console to fix FPS/timing issues.
 *
 * Example usage:
 * resetCompositionSettings('interactive-card-grid');
 */

export function resetCompositionSettings(compositionId: string) {
  const settingsKey = `videos-comp-settings:${compositionId}`;
  const tracksKey = `videos-tracks:${compositionId}`;
  const propsKey = `videos-props:${compositionId}`;

  console.log(`[Reset] Clearing localStorage for composition: ${compositionId}`);

  localStorage.removeItem(settingsKey);
  console.log(`[Reset] Removed ${settingsKey}`);

  // Clear tracks and props to reload from registry
  localStorage.removeItem(tracksKey);
  console.log(`[Reset] Removed ${tracksKey}`);

  localStorage.removeItem(propsKey);
  console.log(`[Reset] Removed ${propsKey}`);

  console.log('[Reset] ✅ Done! Please refresh the page to load fresh data from registry.');
}

/**
 * Reset only the tracks (keyframes, timing) for a composition.
 * Useful when you've added new keyframes to the registry and want to reload them.
 *
 * Example usage:
 * resetTracks('ui-showcase');
 */
export function resetTracks(compositionId: string) {
  const tracksKey = `videos-tracks:${compositionId}`;

  console.log(`[Reset Tracks] Clearing tracks for: ${compositionId}`);
  localStorage.removeItem(tracksKey);
  console.log('[Reset Tracks] ✅ Done! Refresh to load keyframes from registry.');
}

/**
 * Reset the current composition (helper that gets the ID from URL).
 *
 * Example usage:
 * resetCurrent();
 */
export function resetCurrent() {
  const match = window.location.pathname.match(/\/c\/([^\/]+)/);
  if (!match) {
    console.error('[Reset] No composition found in URL. Navigate to a composition first.');
    return;
  }

  const compositionId = match[1];
  resetCompositionSettings(compositionId);
}

// Make utilities available in window for easy console access
if (typeof window !== 'undefined') {
  (window as any).resetCompositionSettings = resetCompositionSettings;
  (window as any).resetTracks = resetTracks;
  (window as any).resetCurrent = resetCurrent;

  console.log(
    '%c[Videos] Reset utilities loaded!',
    'color: #6366f1; font-weight: bold',
    '\n\nAvailable commands:',
    '\n- resetCurrent()          → Reset the current composition',
    '\n- resetTracks("id")       → Reset only tracks/keyframes',
    '\n- resetCompositionSettings("id") → Reset everything\n'
  );
}
