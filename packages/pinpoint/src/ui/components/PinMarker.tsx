// @agent-native/pinpoint — Numbered markers on annotated elements
// MIT License
//
// Rendered OUTSIDE Shadow DOM (need to position across the whole page).
// Real DOM elements for click interactivity (matching annotate fork pattern).

import type { Pin } from "../../types/index.js";

const MAX_MARKERS = 100;

export class PinMarkerManager {
  private markers: Map<string, HTMLElement> = new Map();
  private updateTimer: ReturnType<typeof setInterval> | null = null;
  private onClick: ((pin: Pin) => void) | null = null;

  constructor(private markerColor = "#3b82f6") {}

  /** Set the click handler for markers */
  setOnClick(handler: (pin: Pin) => void) {
    this.onClick = handler;
  }

  /** Sync markers to the current set of pins */
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

    // Create or update markers
    for (let i = 0; i < visiblePins.length; i++) {
      this.updateMarker(visiblePins[i], i + 1);
    }
  }

  private updateMarker(pin: Pin, number: number) {
    const element = document.querySelector(pin.element.selector);
    if (!element) {
      // Element no longer in DOM — hide marker
      const existing = this.markers.get(pin.id);
      if (existing) existing.style.display = "none";
      return;
    }

    let marker = this.markers.get(pin.id);

    if (!marker) {
      marker = document.createElement("div");
      marker.setAttribute("data-pinpoint-marker", pin.id);
      marker.style.cssText = `
        position: fixed;
        z-index: 2147483645;
        pointer-events: auto;
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
        transform: translate3d(0, 0, 0);
        transition: transform 0.1s ease;
        user-select: none;
      `;

      // Click handler
      marker.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        this.onClick?.(pin);
      });

      // Hover scale
      marker.addEventListener("mouseenter", () => {
        marker!.style.transform = "translate3d(0, 0, 0) scale(1.15)";
      });
      marker.addEventListener("mouseleave", () => {
        marker!.style.transform = "translate3d(0, 0, 0) scale(1)";
      });

      document.body.appendChild(marker);
      this.markers.set(pin.id, marker);
    }

    marker.textContent = String(number);
    marker.title = pin.comment;

    // Position at top-right corner of the element
    const rect = element.getBoundingClientRect();
    marker.style.left = `${rect.right - 11}px`;
    marker.style.top = `${rect.top - 11}px`;

    // Hide if off-screen
    const visible =
      rect.bottom > 0 &&
      rect.top < window.innerHeight &&
      rect.right > 0 &&
      rect.left < window.innerWidth;
    marker.style.display = visible ? "flex" : "none";
  }

  /** Start auto-updating marker positions (scroll/resize) */
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
    for (const marker of this.markers.values()) {
      marker.remove();
    }
    this.markers.clear();
  }
}
