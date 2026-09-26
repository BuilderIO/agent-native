
import { render } from "solid-js/web";

import type { PinpointConfig } from "../types/index.js";
import { PinpointApp } from "./components/PinpointApp.js";
import { overlayStyles } from "./styles/theme.js";

const CONTAINER_ID = "pinpoint-root";

interface MountResult {
  dispose: () => void;
  shadowRoot: ShadowRoot;
  container: HTMLDivElement;
}

export function mountPinpoint(
  config: PinpointConfig = {},
  target: HTMLElement = document.body,
): MountResult {
  const w = window as any;

  w.__pinpoint_instances = (w.__pinpoint_instances || 0) + 1;
  if (w.__pinpoint_instances > 1) {
    const existing = document.getElementById(CONTAINER_ID);
    if (existing) {
      existing.remove();
    }
    w.__pinpoint_instances = 1;
  }

  const container = document.createElement("div");
  container.id = CONTAINER_ID;
  container.style.cssText =
    "position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;pointer-events:none;";
  target.appendChild(container);

  const shadowRoot = container.attachShadow({ mode: "open" });

  const sheet = new CSSStyleSheet();
  sheet.replaceSync(overlayStyles);
  shadowRoot.adoptedStyleSheets = [sheet];

  const theme = resolveColorScheme(config.colorScheme || "auto");
  if (theme === "light") {
    container.setAttribute("data-theme", "light");
  }

  const solidDispose = render(() => PinpointApp({ config }), shadowRoot);

  const dispose = () => {
    solidDispose();
    container.remove();
    w.__pinpoint_instances = Math.max(0, (w.__pinpoint_instances || 1) - 1);
  };

  if ((import.meta as any).hot) {
    (import.meta as any).hot.dispose(dispose);
  }

  return { dispose, shadowRoot, container };
}

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
