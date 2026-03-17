// @agent-native/pinpoint — CSS animation freezing
// MIT License

const FREEZE_STYLE_ID = "__pinpoint-css-freeze";

/**
 * Freeze all CSS animations and transitions on the page.
 * Returns a cleanup function to restore.
 */
export function freezeCSS(): () => void {
  if (document.getElementById(FREEZE_STYLE_ID)) {
    return () => {}; // Already frozen
  }

  const style = document.createElement("style");
  style.id = FREEZE_STYLE_ID;
  style.textContent = `*, *::before, *::after {
    animation-play-state: paused !important;
    transition-property: none !important;
  }`;
  document.head.appendChild(style);

  return () => {
    style.remove();
  };
}
