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
  padding: 6px 12px;
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
}

.pp-toolbar--expanded {
  padding: 12px;
  min-width: 280px;
  max-width: 360px;
  max-height: 420px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.pp-toolbar__title {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  color: var(--pp-text-muted);
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
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--pp-accent);
  color: #fff;
  font-size: 11px;
  font-weight: 600;
  flex-shrink: 0;
}

.pp-pin-item__content {
  flex: 1;
  min-width: 0;
}

.pp-pin-item__element {
  font-size: 11px;
  font-family: 'SF Mono', 'Fira Code', 'Fira Mono', Menlo, monospace;
  color: var(--pp-accent);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pp-pin-item__comment {
  font-size: 12px;
  color: var(--pp-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
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

/* Action bar */
.pp-actions {
  display: flex;
  gap: 6px;
  padding-top: 8px;
  border-top: 1px solid var(--pp-border);
}

.pp-actions .pp-btn {
  flex: 1;
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
  padding: 12px;
  min-width: 300px;
  max-width: 420px;
  display: flex;
  flex-direction: column;
  gap: 8px;
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
}

.pp-popup__source:hover {
  color: var(--pp-accent);
  text-decoration: underline;
}

.pp-popup__textarea {
  width: 100%;
  min-height: 60px;
  padding: 8px;
  border: 1px solid var(--pp-border);
  border-radius: var(--pp-radius-sm);
  background: rgba(0, 0, 0, 0.2);
  color: var(--pp-text);
  font-size: 13px;
  font-family: inherit;
  resize: vertical;
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
