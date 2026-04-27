// @agent-native/pinpoint — Pin markers: outline + numbered badge per element
// MIT License
//
// Each pin gets a wrapper div containing:
//   1. An outline border div (positioned over the element)
//   2. A numbered badge circle (at the top-right corner)
//   3. An optional selection checkbox (at the top-left corner)
//   4. A resolved checkmark overlay when status is resolved
// Rendered outside Shadow DOM on document.body.

import type { Pin, PinStatus } from "../../types/index.js";

const MAX_MARKERS = 100;

// Badge sizing constants
const BADGE_SIZE = 20;
const BADGE_FONT = 11;
const BADGE_OFFSET = -10;

// Status colors
const STATUS_COLORS: Record<PinStatus, string> = {
  open: "#3b82f6",
  acknowledged: "#eab308",
  resolved: "#22c55e",
  dismissed: "#a1a1aa",
};

interface MarkerPair {
  wrapper: HTMLElement;
  outline: HTMLElement;
  badge: HTMLElement;
  checkbox: HTMLElement;
  resolvedOverlay: HTMLElement;
}

export class PinMarkerManager {
  private markers: Map<string, MarkerPair> = new Map();
  private updateTimer: ReturnType<typeof setInterval> | null = null;
  private onClick: ((pin: Pin) => void) | null = null;
  private onToggleSelect: ((pin: Pin) => void) | null = null;
  private selectedPinIds: Set<string> = new Set();
  private showCheckboxes = false;

  constructor(private markerColor = "#3b82f6") {}

  setOnClick(handler: (pin: Pin) => void) {
    this.onClick = handler;
  }

  setOnToggleSelect(handler: (pin: Pin) => void) {
    this.onToggleSelect = handler;
  }

  setSelectedPins(ids: Set<string>) {
    this.selectedPinIds = ids;
    // Update checkbox visuals
    for (const [id, pair] of this.markers) {
      this.updateCheckboxVisual(pair.checkbox, ids.has(id));
    }
  }

  setShowCheckboxes(show: boolean) {
    this.showCheckboxes = show;
    for (const pair of this.markers.values()) {
      pair.checkbox.style.display = show ? "flex" : "none";
    }
  }

  update(pins: Pin[]) {
    const visiblePins = pins.slice(0, MAX_MARKERS);
    const pinIds = new Set(visiblePins.map((p) => p.id));

    for (const [id, pair] of this.markers) {
      if (!pinIds.has(id)) {
        pair.wrapper.remove();
        this.markers.delete(id);
      }
    }

    for (let i = 0; i < visiblePins.length; i++) {
      this.updateMarker(visiblePins[i], i + 1);
    }
  }

  private updateCheckboxVisual(checkbox: HTMLElement, selected: boolean) {
    const inner = checkbox.querySelector(
      ".pp-marker-checkbox-inner",
    ) as HTMLElement;
    if (!inner) return;
    if (selected) {
      inner.style.background = "#3b82f6";
      inner.style.borderColor = "#3b82f6";
      inner.innerHTML = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5l10 -10"/></svg>`;
    } else {
      inner.style.background = "rgba(0,0,0,0.5)";
      inner.style.borderColor = "rgba(255,255,255,0.3)";
      inner.innerHTML = "";
    }
  }

  private updateMarker(pin: Pin, number: number) {
    const element = document.querySelector(pin.element.selector);
    if (!element) {
      const existing = this.markers.get(pin.id);
      if (existing) existing.wrapper.style.display = "none";
      return;
    }

    let pair = this.markers.get(pin.id);
    const statusColor = STATUS_COLORS[pin.status.state] || this.markerColor;

    if (!pair) {
      // Wrapper
      const wrapper = document.createElement("div");
      wrapper.setAttribute("data-pinpoint-marker", pin.id);
      wrapper.style.cssText = `
        position: fixed;
        z-index: 2147483646;
        pointer-events: none;
      `;

      // Outline border
      const outline = document.createElement("div");
      outline.style.cssText = `
        position: absolute;
        top: 0; left: 0;
        width: 100%; height: 100%;
        border: 1.5px solid ${statusColor};
        border-radius: 3px;
        pointer-events: none;
        opacity: 0.6;
      `;

      // Numbered badge
      const badge = document.createElement("div");
      badge.style.cssText = `
        position: absolute;
        top: ${BADGE_OFFSET}px;
        right: ${BADGE_OFFSET}px;
        width: ${BADGE_SIZE}px;
        height: ${BADGE_SIZE}px;
        min-width: ${BADGE_SIZE}px;
        padding: 0 4px;
        border-radius: ${BADGE_SIZE / 2}px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: ${BADGE_FONT}px;
        font-weight: 600;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-variant-numeric: tabular-nums;
        color: #fff;
        background: ${statusColor};
        box-shadow: 0 1px 4px rgba(0,0,0,0.2);
        cursor: pointer;
        pointer-events: auto;
        user-select: none;
        z-index: 1;
        animation: pp-badge-appear 0.2s cubic-bezier(0.16, 1, 0.3, 1);
      `;

      // Add keyframes if not yet added
      if (!document.getElementById("pp-marker-keyframes")) {
        const style = document.createElement("style");
        style.id = "pp-marker-keyframes";
        style.textContent = `
          @keyframes pp-badge-appear {
            from { transform: scale(0); opacity: 0; }
            to { transform: scale(1); opacity: 1; }
          }
        `;
        document.head.appendChild(style);
      }

      badge.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        this.onClick?.(pin);
      });

      badge.addEventListener("mouseenter", () => {
        badge.style.transform = "scale(1.15)";
      });
      badge.addEventListener("mouseleave", () => {
        badge.style.transform = "scale(1)";
      });

      // Selection checkbox
      const checkbox = document.createElement("div");
      checkbox.style.cssText = `
        position: absolute;
        top: ${BADGE_OFFSET}px;
        left: ${BADGE_OFFSET}px;
        width: ${BADGE_SIZE}px;
        height: ${BADGE_SIZE}px;
        display: ${this.showCheckboxes ? "flex" : "none"};
        align-items: center;
        justify-content: center;
        cursor: pointer;
        pointer-events: auto;
        z-index: 1;
      `;

      const checkboxInner = document.createElement("div");
      checkboxInner.className = "pp-marker-checkbox-inner";
      checkboxInner.style.cssText = `
        width: 16px;
        height: 16px;
        border-radius: 4px;
        border: 1.5px solid rgba(255,255,255,0.3);
        background: rgba(0,0,0,0.5);
        display: flex;
        align-items: center;
        justify-content: center;
      `;
      checkbox.appendChild(checkboxInner);

      checkbox.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        this.onToggleSelect?.(pin);
      });

      // Resolved overlay checkmark
      const resolvedOverlay = document.createElement("div");
      resolvedOverlay.style.cssText = `
        position: absolute;
        top: 0; left: 0;
        width: 100%; height: 100%;
        display: ${pin.status.state === "resolved" ? "flex" : "none"};
        align-items: center;
        justify-content: center;
        background: rgba(34, 197, 94, 0.12);
        border-radius: 3px;
        pointer-events: none;
      `;
      resolvedOverlay.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5l10 -10"/></svg>`;

      wrapper.appendChild(outline);
      wrapper.appendChild(badge);
      wrapper.appendChild(checkbox);
      wrapper.appendChild(resolvedOverlay);
      document.body.appendChild(wrapper);

      pair = { wrapper, outline, badge, checkbox, resolvedOverlay };
      this.markers.set(pin.id, pair);
    }

    // Update dynamic properties
    pair.badge.textContent = String(number);
    pair.badge.title = pin.comment;
    pair.badge.style.background = statusColor;
    pair.outline.style.borderColor = statusColor;
    pair.resolvedOverlay.style.display =
      pin.status.state === "resolved" ? "flex" : "none";
    this.updateCheckboxVisual(pair.checkbox, this.selectedPinIds.has(pin.id));

    // Position wrapper to cover the element
    const rect = element.getBoundingClientRect();
    pair.wrapper.style.left = `${rect.left}px`;
    pair.wrapper.style.top = `${rect.top}px`;
    pair.wrapper.style.width = `${rect.width}px`;
    pair.wrapper.style.height = `${rect.height}px`;

    // Visibility
    const visible =
      rect.bottom > 0 &&
      rect.top < window.innerHeight &&
      rect.right > 0 &&
      rect.left < window.innerWidth;
    pair.wrapper.style.display = visible ? "block" : "none";
  }

  startTracking(pins: Pin[]) {
    this.stopTracking();
    this.update(pins);
    this.updateTimer = setInterval(() => this.update(pins), 200);
  }

  stopTracking() {
    if (this.updateTimer) {
      clearInterval(this.updateTimer);
      this.updateTimer = null;
    }
  }

  dispose() {
    this.stopTracking();
    for (const pair of this.markers.values()) {
      pair.wrapper.remove();
    }
    this.markers.clear();
  }
}
