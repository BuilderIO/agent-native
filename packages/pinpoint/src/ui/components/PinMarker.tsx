// @agent-native/pinpoint — Numbered markers on annotated elements
// MIT License
//
// Rendered OUTSIDE Shadow DOM (need to position across the whole page).
// Uses minimal inline styles. IntersectionObserver for visibility.

import type { Pin } from "../../types/index.js";

const MAX_MARKERS = 100;

/**
 * Create and manage pin markers in the DOM.
 * Markers are outside Shadow DOM so they can be positioned anywhere on the page.
 */
export class PinMarkerManager {
  private markers: Map<string, HTMLElement> = new Map();
  private observer: IntersectionObserver | null = null;
  private updateTimer: ReturnType<typeof setInterval> | null = null;
  private markerColor: string;

  constructor(markerColor = "#3b82f6") {
    this.markerColor = markerColor;
  }

  /**
   * Sync markers to the current set of pins.
   */
  update(pins: Pin[]) {
    const visiblePins = pins.slice(0, MAX_MARKERS);
    const pinIds = new Set(visiblePins.map((p) => p.id));

    // Remove markers for deleted pins
    for (const [id, marker] of this.markers) {
      if (!pinIds.has(id)) {
        marker.remove();
        this.markers.delete(id);
      }
    }

    // Create or update markers for current pins
    for (let i = 0; i < visiblePins.length; i++) {
      const pin = visiblePins[i];
      this.updateMarker(pin, i + 1);
    }
  }

  private updateMarker(pin: Pin, number: number) {
    const element = document.querySelector(pin.element.selector);
    if (!element) return;

    let marker = this.markers.get(pin.id);

    if (!marker) {
      marker = document.createElement("div");
      marker.setAttribute("data-pinpoint-marker", pin.id);
      marker.style.cssText = `
        position: fixed;
        z-index: 2147483645;
        pointer-events: none;
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
        box-shadow: 0 2px 6px rgba(0,0,0,0.25), 0 0 0 2px rgba(255,255,255,0.9);
        transform: translate3d(0, 0, 0);
        transition: transform 0.15s ease;
      `;
      document.body.appendChild(marker);
      this.markers.set(pin.id, marker);
    }

    // Status color
    const statusColors: Record<string, string> = {
      open: "#ef4444",
      acknowledged: "#eab308",
      resolved: "#22c55e",
      dismissed: "#71717a",
    };

    marker.style.background =
      statusColors[pin.status.state] || this.markerColor;
    marker.textContent = String(number);
    marker.title = `${pin.comment}\n${pin.author ? `by ${pin.author}` : ""}`;

    // Position at top-right corner of the element
    const rect = element.getBoundingClientRect();
    marker.style.left = `${rect.right - 11}px`;
    marker.style.top = `${rect.top - 11}px`;

    // Hide if element is out of viewport
    const visible =
      rect.bottom > 0 &&
      rect.top < window.innerHeight &&
      rect.right > 0 &&
      rect.left < window.innerWidth;
    marker.style.display = visible ? "flex" : "none";
  }

  /**
   * Start auto-updating marker positions (for scroll/resize).
   */
  startTracking(pins: Pin[]) {
    this.stopTracking();
    this.updateTimer = setInterval(() => this.update(pins), 200);
  }

  /**
   * Stop auto-updating.
   */
  stopTracking() {
    if (this.updateTimer) {
      clearInterval(this.updateTimer);
      this.updateTimer = null;
    }
  }

  /**
   * Remove all markers from the DOM.
   */
  dispose() {
    this.stopTracking();
    for (const marker of this.markers.values()) {
      marker.remove();
    }
    this.markers.clear();
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
  }
}
