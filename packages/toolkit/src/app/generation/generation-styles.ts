import { STREAMED_IN_CSS } from "@agent-native/core/client/generation-stream";

/**
 * Apps tint the motion by setting `--agent-native-generating-accent` (their
 * selection color) on any ancestor; it falls back to the theme's primary
 * color. The label's wash is a lighter, cooler blue derived from it, or
 * `--agent-native-generating-wash`.
 */
const GENERATION_CSS = `
.an-generating {
  --an-generating-accent: var(--agent-native-generating-accent, var(--color-primary));
  --an-generating-wash: var(
    --agent-native-generating-wash,
    oklch(from var(--an-generating-accent) calc(l + 0.16) c calc(h - 35))
  );
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.an-generating-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 16px;
  font-size: 12px;
  line-height: 16px;
  font-weight: 500;
  white-space: nowrap;
  color: var(--color-muted-foreground);
}
.an-generating-label[data-active] .an-generating-label-text {
  background-image: linear-gradient(
    90deg,
    var(--an-generating-accent) 0%,
    var(--an-generating-accent) 30%,
    var(--an-generating-wash) 50%,
    var(--an-generating-accent) 70%,
    var(--an-generating-accent) 100%
  );
  background-size: 300% 100%;
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  animation: an-generating-shimmer 2.2s linear infinite;
}
@keyframes an-generating-shimmer {
  from { background-position: 100% 0; }
  to { background-position: 0% 0; }
}
.an-generating-surface {
  position: relative;
  overflow: hidden;
  border-radius: inherit;
}
.an-generating-surface::after {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  pointer-events: none;
  box-shadow: inset 0 0 0 1.5px var(--an-generating-accent);
  opacity: 0;
  transition: opacity 400ms ease;
}
/* The working frame reads as the active selection; the label carries the motion. */
.an-generating[data-status="pending"] .an-generating-surface::after,
.an-generating[data-status="streaming"] .an-generating-surface::after {
  opacity: 1;
}
.an-generating[data-status="failed"] .an-generating-surface::after {
  opacity: 1;
  box-shadow: inset 0 0 0 1px var(--color-border);
}
.an-generating-layer {
  position: absolute;
  inset: 0;
  transition: opacity 320ms ease;
}
@media (prefers-reduced-motion: reduce) {
  .an-generating-label[data-active] .an-generating-label-text {
    animation: none;
    color: var(--an-generating-accent);
    background-image: none;
  }
  .an-generating-layer { transition: none; }
}
${STREAMED_IN_CSS}
`;

let stylesInjected = false;

export function injectGenerationStyles(): void {
  if (stylesInjected || typeof document === "undefined") return;
  const style = document.createElement("style");
  style.dataset.agentNativeGeneration = "";
  style.textContent = GENERATION_CSS;
  document.head.appendChild(style);
  stylesInjected = true;
}
