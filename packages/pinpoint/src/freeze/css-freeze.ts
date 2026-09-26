// @agent-native/pinpoint — CSS animation freezing
// MIT License

const FREEZE_STYLE_ID = "__pinpoint-css-freeze";

export function freezeCSS(): () => void {
  if (document.getElementById(FREEZE_STYLE_ID)) {
    return () => {};
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
