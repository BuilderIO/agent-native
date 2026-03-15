import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.js";
import "./shell.css";

// Apply platform class to body so CSS can adapt per OS
// (e.g. add padding for macOS traffic lights)
const platform = window.electronAPI?.platform ?? "unknown";
document.body.classList.add(`platform-${platform}`);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
