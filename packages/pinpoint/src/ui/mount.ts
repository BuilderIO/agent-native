// @agent-native/pinpoint — Shadow DOM mounting with singleton guard
// MIT License
//
// Mounts the SolidJS overlay app inside Shadow DOM for perfect CSS isolation.
// Singleton guard prevents multiple toolbar instances (HMR-safe).

import { render } from "solid-js/web";
import { overlayStyles } from "./styles/theme.js";
import { PinpointApp } from "./components/PinpointApp.js";
import type { PinpointConfig } from "../types/index.js";

const CONTAINER_ID = "pinpoint-root";

interface MountResult {
  dispose: () => void;
  shadowRoot: ShadowRoot;
  container: HTMLDivElement;
}

/**
 * Mount the Pinpoint overlay into the DOM.
 * Uses Shadow DOM for CSS isolation.
 * Singleton guard prevents multiple instances (HMR-safe).
 */
export function mountPinpoint(
  config: PinpointConfig = {},
  target: HTMLElement = document.body,
): MountResult {
  const w = window as any;

  // Singleton guard — our design from the fork, HMR-safe
  w.__pinpoint_instances = (w.__pinpoint_instances || 0) + 1;
  if (w.__pinpoint_instances > 1) {
    // Already mounted — dispose the old one first
    const existing = document.getElementById(CONTAINER_ID);
    if (existing) {
      existing.remove();
    }
    w.__pinpoint_instances = 1;
  }

  // Create the container (fixed, zero-size, highest z-index)
  const container = document.createElement("div");
  container.id = CONTAINER_ID;
  container.style.cssText =
    "position:fixed;top:0;left:0;width:0;height:0;z-index:2147483646;pointer-events:none;";
  target.appendChild(container);

  // Create Shadow DOM
  const shadowRoot = container.attachShadow({ mode: "open" });

  // Inject styles via CSSStyleSheet (modern, performant)
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(overlayStyles);
  shadowRoot.adoptedStyleSheets = [sheet];

  // Set theme
  const theme = resolveColorScheme(config.colorScheme || "auto");
  if (theme === "light") {
    container.setAttribute("data-theme", "light");
  }

  // Render SolidJS app into Shadow DOM
  const solidDispose = render(() => PinpointApp({ config }), shadowRoot);

  const dispose = () => {
    solidDispose();
    container.remove();
    w.__pinpoint_instances = Math.max(0, (w.__pinpoint_instances || 1) - 1);
  };

  // Listen for HMR dispose
  if ((import.meta as any).hot) {
    (import.meta as any).hot.dispose(dispose);
  }

  return { dispose, shadowRoot, container };
}

/**
 * Unmount Pinpoint from the DOM.
 */
export function unmountPinpoint(): void {
  const container = document.getElementById(CONTAINER_ID);
  if (container) {
    container.remove();
    (window as any).__pinpoint_instances = 0;
  }
}

function resolveColorScheme(
  scheme: "auto" | "light" | "dark",
): "light" | "dark" {
  if (scheme === "auto") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }
  return scheme;
}
