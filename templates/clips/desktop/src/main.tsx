import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./app";
import { Countdown } from "./overlays/countdown";
import { Toolbar } from "./overlays/toolbar";
import { Bubble } from "./overlays/bubble";
import { Finalizing } from "./overlays/finalizing";
import "./styles.css";

/**
 * One bundle, one HTML, five views. We pick which component to mount based
 * on the URL hash so each Tauri window (spawned from Rust with
 * `index.html#<name>`) renders only what it needs.
 */
function pickRoute(): React.ReactElement {
  const hash = window.location.hash.replace(/^#/, "").toLowerCase();
  switch (hash) {
    case "countdown":
      return <Countdown />;
    case "toolbar":
      return <Toolbar />;
    case "bubble":
      return <Bubble />;
    case "finalizing":
      return <Finalizing />;
    default:
      return <App />;
  }
}

const rootEl = document.getElementById("root");
if (rootEl) {
  // NOTE: intentionally NOT wrapping in React.StrictMode. StrictMode
  // double-mounts effects in development, which means every useEffect
  // that invokes a Tauri command runs twice (show_bubble / resize_popover
  // / etc.), producing the rapid-fire flicker we were seeing where the
  // camera bubble re-created itself ~30 times a second. Tauri windows
  // are real OS resources — not an environment where double-mount is
  // harmless.
  ReactDOM.createRoot(rootEl).render(pickRoute());
}
