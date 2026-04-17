import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./app";
import { Countdown } from "./overlays/countdown";
import { Toolbar } from "./overlays/toolbar";
import { Bubble } from "./overlays/bubble";
import "./styles.css";

/**
 * One bundle, one HTML, four views. We pick which component to mount based
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
    default:
      return <App />;
  }
}

const rootEl = document.getElementById("root");
if (rootEl) {
  ReactDOM.createRoot(rootEl).render(
    <React.StrictMode>{pickRoute()}</React.StrictMode>,
  );
}
