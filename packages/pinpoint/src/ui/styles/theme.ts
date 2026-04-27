// @agent-native/pinpoint — CSS theme and styles
// MIT License
//
// Compiled CSS for Shadow DOM injection via CSSStyleSheet.
// Uses CSS custom properties with --pp- prefix for theming.

export const overlayStyles = `
:host {
  all: initial;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  font-size: 13px;
  line-height: 1.4;
  color: var(--pp-text);
  pointer-events: none;
}

*,
*::before,
*::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

/* Theme variables */
:host {
  --pp-bg: rgba(24, 24, 27, 0.92);
  --pp-bg-solid: #18181b;
  --pp-text: #fafafa;
  --pp-text-muted: #a1a1aa;
  --pp-border: rgba(63, 63, 70, 0.6);
  --pp-accent: #3b82f6;
  --pp-accent-hover: #60a5fa;
  --pp-success: #22c55e;
  --pp-warning: #eab308;
  --pp-danger: #ef4444;
  --pp-shadow: 0 4px 24px rgba(0, 0, 0, 0.3), 0 0 0 1px rgba(255, 255, 255, 0.06);
  --pp-radius: 10px;
  --pp-radius-sm: 6px;
}

:host([data-theme="light"]) {
  --pp-bg: rgba(255, 255, 255, 0.92);
  --pp-bg-solid: #ffffff;
  --pp-text: #18181b;
  --pp-text-muted: #71717a;
  --pp-border: rgba(228, 228, 231, 0.8);
  --pp-accent: #2563eb;
  --pp-accent-hover: #3b82f6;
  --pp-shadow: 0 4px 24px rgba(0, 0, 0, 0.08), 0 0 0 1px rgba(0, 0, 0, 0.06);
}

:host([data-theme="light"]) .pp-popup__textarea {
  background: rgba(0, 0, 0, 0.06);
}

/* Toolbar */
.pp-toolbar {
  position: fixed;
  z-index: 2147483646;
  pointer-events: auto;
  backdrop-filter: blur(12px) saturate(180%);
  -webkit-backdrop-filter: blur(12px) saturate(180%);
  background: var(--pp-bg);
  border: 1px solid var(--pp-border);
  border-radius: var(--pp-radius);
  box-shadow: var(--pp-shadow);
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  user-select: none;
  cursor: default;
}

.pp-toolbar--collapsed {
  padding: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  cursor: pointer;
}

.pp-toolbar--expanded {
  padding: 12px;
  width: 320px;
  max-height: 420px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.pp-toolbar__badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 9px;
  background: var(--pp-accent);
  color: #fff;
  font-size: 11px;
  font-weight: 600;
}

/* Buttons */
.pp-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 5px 10px;
  border: 1px solid var(--pp-border);
  border-radius: var(--pp-radius-sm);
  background: transparent;
  color: var(--pp-text);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
}

.pp-btn:hover {
  background: rgba(255, 255, 255, 0.06);
  border-color: var(--pp-accent);
}

.pp-btn--primary {
  background: var(--pp-accent);
  border-color: var(--pp-accent);
  color: #fff;
}

.pp-btn--primary:hover {
  background: var(--pp-accent-hover);
}

.pp-btn--sm {
  padding: 3px 6px;
  font-size: 11px;
}

.pp-btn--icon {
  padding: 4px;
  border: none;
  background: transparent;
  color: var(--pp-text-muted);
  cursor: pointer;
  border-radius: var(--pp-radius-sm);
}

.pp-btn--icon:hover {
  background: rgba(255, 255, 255, 0.06);
  color: var(--pp-text);
}

.pp-btn--icon-sm {
  padding: 2px;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.15s ease, color 0.15s ease, background-color 0.15s ease;
}

.pp-pin-item:hover .pp-btn--icon-sm,
.pp-pin-item:focus-within .pp-btn--icon-sm {
  opacity: 1;
  pointer-events: auto;
}

.pp-btn--icon-sm:hover {
  background: rgba(239, 68, 68, 0.15);
  color: var(--pp-danger);
}

@media (hover: none) {
  .pp-btn--icon-sm {
    opacity: 0.6;
    pointer-events: auto;
  }
}

@media (prefers-reduced-motion: reduce) {
  .pp-btn--icon-sm { transition: none; }
}

/* Pin list */
.pp-pin-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  overflow-y: auto;
  max-height: 240px;
  scrollbar-width: thin;
  scrollbar-color: var(--pp-border) transparent;
}

.pp-pin-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: var(--pp-radius-sm);
  cursor: pointer;
  transition: background 0.1s;
}

.pp-pin-item:hover {
  background: rgba(255, 255, 255, 0.04);
}

.pp-pin-item__number {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  min-width: 22px;
  padding: 0 4px;
  border-radius: 11px;
  background: var(--pp-accent);
  color: #fff;
  font-size: 11px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}

.pp-pin-item__content {
  flex: 1;
  min-width: 0;
}

.pp-pin-item__comment {
  font-size: 12px;
  color: var(--pp-text);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-word;
}

.pp-pin-item__status {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

.pp-pin-item__status--open { background: var(--pp-danger); }
.pp-pin-item__status--acknowledged { background: var(--pp-warning); }
.pp-pin-item__status--resolved { background: var(--pp-success); }
.pp-pin-item__status--dismissed { background: var(--pp-text-muted); }

/* Action bar — horizontal icon bar at bottom */
.pp-actions {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding-top: 8px;
  border-top: 1px solid var(--pp-border);
}

.pp-actions .pp-btn--icon {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.pp-actions .pp-btn--icon:focus-visible {
  outline: 2px solid var(--pp-accent);
  outline-offset: 2px;
}

/* Popup */
.pp-popup {
  position: fixed;
  z-index: 2147483647;
  pointer-events: auto;
  backdrop-filter: blur(12px) saturate(180%);
  -webkit-backdrop-filter: blur(12px) saturate(180%);
  background: var(--pp-bg);
  border: 1px solid var(--pp-border);
  border-radius: var(--pp-radius);
  box-shadow: var(--pp-shadow);
  padding: 10px;
  min-width: 280px;
  max-width: 360px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.pp-popup__element-info {
  font-size: 11px;
  font-family: 'SF Mono', 'Fira Code', monospace;
  color: var(--pp-accent);
  word-break: break-all;
}

.pp-popup__component {
  font-size: 12px;
  color: var(--pp-text-muted);
}

.pp-popup__source {
  font-size: 11px;
  color: var(--pp-text-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 4px;
}

.pp-popup__source:hover {
  color: var(--pp-accent);
  text-decoration: underline;
}

/* Popup header with chevron toggle */
.pp-popup__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  cursor: pointer;
  padding: 2px 0;
}

.pp-popup__name {
  font-size: 12px;
  font-weight: 500;
  color: var(--pp-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 280px;
}

.pp-popup__chevron {
  color: var(--pp-text-muted);
  transition: transform 0.15s ease;
  display: flex;
  align-items: center;
  flex-shrink: 0;
  transform: rotate(-90deg);
}

.pp-popup__chevron--open {
  transform: rotate(0deg);
}

/* CSS-based collapsible — keeps DOM, animates height */
.pp-popup__details {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 0.2s ease-out;
}

.pp-popup__details--open {
  grid-template-rows: 1fr;
}

.pp-popup__details-inner {
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

@media (prefers-reduced-motion: reduce) {
  .pp-popup__chevron,
  .pp-popup__details {
    transition: none;
  }
}

.pp-popup__textarea {
  width: 100%;
  min-height: 48px;
  max-height: 120px;
  padding: 8px;
  border: 1px solid var(--pp-border);
  border-radius: var(--pp-radius-sm);
  background: rgba(0, 0, 0, 0.2);
  color: var(--pp-text);
  font-size: 13px;
  font-family: inherit;
  resize: none;
  overflow-y: auto;
  outline: none;
}

.pp-popup__textarea:focus {
  border-color: var(--pp-accent);
}

.pp-popup__actions {
  display: flex;
  gap: 6px;
  justify-content: flex-end;
}

.pp-popup__actions .pp-btn {
  height: 26px;
  padding: 0 10px;
  font-size: 12px;
}

/* Selection label */
.pp-selection-label {
  position: fixed;
  z-index: 2147483646;
  pointer-events: none;
  padding: 3px 8px;
  border-radius: 4px;
  background: var(--pp-accent);
  color: #fff;
  font-size: 11px;
  font-weight: 500;
  white-space: nowrap;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
}

/* Context menu */
.pp-context-menu {
  position: fixed;
  z-index: 2147483647;
  pointer-events: auto;
  background: var(--pp-bg-solid);
  border: 1px solid var(--pp-border);
  border-radius: var(--pp-radius-sm);
  box-shadow: var(--pp-shadow);
  padding: 4px;
  min-width: 180px;
}

.pp-context-menu__item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  color: var(--pp-text);
  transition: background 0.1s;
}

.pp-context-menu__item:hover {
  background: rgba(255, 255, 255, 0.06);
}

.pp-context-menu__separator {
  height: 1px;
  background: var(--pp-border);
  margin: 4px 0;
}

/* Prompt mode */
.pp-prompt {
  position: fixed;
  z-index: 2147483647;
  pointer-events: auto;
  display: flex;
  gap: 6px;
  align-items: center;
}

.pp-prompt__input {
  padding: 6px 10px;
  border: 1px solid var(--pp-accent);
  border-radius: var(--pp-radius-sm);
  background: var(--pp-bg);
  color: var(--pp-text);
  font-size: 13px;
  font-family: inherit;
  min-width: 240px;
  outline: none;
  backdrop-filter: blur(12px) saturate(180%);
}

/* Settings panel */
.pp-settings {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--pp-border);
}

.pp-settings__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.pp-settings__label {
  font-size: 12px;
  color: var(--pp-text);
}

.pp-settings__value {
  font-size: 11px;
  color: var(--pp-text-muted);
}

/* Toggle switch */
.pp-toggle {
  position: relative;
  width: 32px;
  height: 18px;
  border-radius: 9px;
  background: var(--pp-border);
  cursor: pointer;
  transition: background 0.2s;
}

.pp-toggle--active {
  background: var(--pp-accent);
}

.pp-toggle__thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #fff;
  transition: transform 0.2s;
}

.pp-toggle--active .pp-toggle__thumb {
  transform: translateX(14px);
}

/* Kbd hints */
.pp-kbd {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 1px 4px;
  border: 1px solid var(--pp-border);
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.04);
  font-size: 10px;
  font-family: inherit;
  color: var(--pp-text-muted);
  line-height: 1;
}

/* Mode tabs */
.pp-mode-tabs {
  display: flex;
  gap: 2px;
  padding: 2px;
  background: rgba(255, 255, 255, 0.04);
  border-radius: var(--pp-radius-sm);
}

.pp-mode-tab {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 5px 8px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--pp-text-muted);
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
}

.pp-mode-tab:hover {
  color: var(--pp-text);
  background: rgba(255, 255, 255, 0.04);
}

.pp-mode-tab--active {
  background: rgba(255, 255, 255, 0.08);
  color: var(--pp-text);
}

.pp-mode-tab__count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 8px;
  background: var(--pp-accent);
  color: #fff;
  font-size: 10px;
  font-weight: 600;
}

/* Draw tools bar */
.pp-draw-tools {
  display: flex;
  align-items: center;
  gap: 2px;
}

.pp-draw-tool {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: var(--pp-radius-sm);
  background: transparent;
  color: var(--pp-text-muted);
  cursor: pointer;
}

.pp-draw-tool:hover {
  background: rgba(255, 255, 255, 0.06);
  color: var(--pp-text);
}

.pp-draw-tool--active {
  background: rgba(59, 130, 246, 0.15);
  color: var(--pp-accent);
}

.pp-draw-tool:disabled {
  opacity: 0.3;
  cursor: default;
}

/* Draw options row */
.pp-draw-options {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.pp-draw-colors {
  display: flex;
  gap: 4px;
}

.pp-color-swatch {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 2px solid transparent;
  cursor: pointer;
  padding: 0;
}

.pp-color-swatch:hover {
  opacity: 0.85;
}

.pp-color-swatch--active {
  border-color: #fff;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.3);
}

.pp-draw-widths {
  display: flex;
  gap: 4px;
}

.pp-width-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: var(--pp-radius-sm);
  background: transparent;
  cursor: pointer;
  padding: 0;
}

.pp-width-btn:hover {
  background: rgba(255, 255, 255, 0.06);
}

.pp-width-btn--active {
  background: rgba(255, 255, 255, 0.1);
  outline: 1px solid var(--pp-border);
}

/* Queue badge in toolbar header */
.pp-toolbar__queue-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 9px;
  background: var(--pp-warning);
  color: #000;
  font-size: 10px;
  font-weight: 700;
}

/* Popup input row with mic */
.pp-popup__input-row {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 4px;
}

.pp-popup__input-row .pp-popup__textarea {
  flex: 1;
}

.pp-popup__mic {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  margin-top: 4px;
}

.pp-popup__mic--recording {
  color: var(--pp-danger) !important;
  background: rgba(239, 68, 68, 0.15) !important;
  animation: pp-mic-pulse 1.2s ease-in-out infinite;
}

@keyframes pp-mic-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.4); }
  50% { box-shadow: 0 0 0 6px rgba(239, 68, 68, 0); }
}

/* Ghost button (Fix this) */
.pp-btn--ghost {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border: none;
  border-radius: var(--pp-radius-sm);
  background: transparent;
  color: var(--pp-warning);
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
}

.pp-btn--ghost:hover {
  background: rgba(234, 179, 8, 0.1);
}

/* Text input popup for draw-mode text annotations */
.pp-text-input-popup {
  position: fixed;
  z-index: 2147483647;
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  background: var(--pp-bg);
  border: 1px solid var(--pp-border);
  border-radius: var(--pp-radius-sm);
  box-shadow: var(--pp-shadow);
  backdrop-filter: blur(12px) saturate(180%);
  -webkit-backdrop-filter: blur(12px) saturate(180%);
}

.pp-text-input-popup__indicator {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.pp-text-input-popup__input {
  border: none;
  background: transparent;
  color: var(--pp-text);
  font-size: 13px;
  font-family: inherit;
  outline: none;
  min-width: 200px;
}

/* Scrollbar */
::-webkit-scrollbar {
  width: 4px;
}

::-webkit-scrollbar-track {
  background: transparent;
}

::-webkit-scrollbar-thumb {
  background: var(--pp-border);
  border-radius: 2px;
}
`;
