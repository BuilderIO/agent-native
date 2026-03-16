// @agent-native/pinpoint — Pin markers: outline + numbered badge per element
// MIT License
//
// Each pin gets a wrapper div containing:
//   1. An outline border div (positioned over the element)
//   2. A numbered badge circle (at the top-right corner)
// Both in the same stacking context so badge is always above outline.
// Rendered outside Shadow DOM on document.body.

import type { Pin } from "../../types/index.js";

const MAX_MARKERS = 100;

interface MarkerPair {
  wrapper: HTMLElement;
  outline: HTMLElement;
  badge: HTMLElement;
}

export class PinMarkerManager {
  private markers: Map<string, MarkerPair> = new Map();
  private updateTimer: ReturnType<typeof setInterval> | null = null;
  private onClick: ((pin: Pin) => void) | null = null;

  constructor(private markerColor = "#3b82f6") {}

  setOnClick(handler: (pin: Pin) => void) {
    this.onClick = handler;
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

  private updateMarker(pin: Pin, number: number) {
    const element = document.querySelector(pin.element.selector);
    if (!element) {
      const existing = this.markers.get(pin.id);
      if (existing) existing.wrapper.style.display = "none";
      return;
    }

    let pair = this.markers.get(pin.id);

    if (!pair) {
      // Wrapper — contains both outline and badge
      const wrapper = document.createElement("div");
      wrapper.setAttribute("data-pinpoint-marker", pin.id);
      wrapper.style.cssText = `
        position: fixed;
        z-index: 2147483646;
        pointer-events: none;
      `;

      // Outline — border around the annotated element
      const outline = document.createElement("div");
      outline.style.cssText = `
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        border: 1.5px solid ${this.markerColor};
        border-radius: 3px;
        pointer-events: none;
        opacity: 0.6;
      `;

      // Badge — numbered circle at corner
      const badge = document.createElement("div");
      badge.style.cssText = `
        position: absolute;
        top: -11px;
        right: -11px;
        width: 22px;
        height: 22px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 11px;
        font-weight: 600;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        color: #fff;
        background: ${this.markerColor};
        box-shadow: 0 2px 6px rgba(0,0,0,0.25), 0 0 0 2px rgba(255,255,255,0.9);
        cursor: pointer;
        pointer-events: auto;
        transition: transform 0.1s ease;
        user-select: none;
        z-index: 1;
      `;

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

      wrapper.appendChild(outline);
      wrapper.appendChild(badge);
      document.body.appendChild(wrapper);

      pair = { wrapper, outline, badge };
      this.markers.set(pin.id, pair);
    }

    pair.badge.textContent = String(number);
    pair.badge.title = pin.comment;

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
