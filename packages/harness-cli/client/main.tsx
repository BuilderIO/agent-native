import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { HarnessConfigProvider } from "./lib/config";
import { allHarnesses } from "./harnesses";
import "./global.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <HarnessConfigProvider configs={allHarnesses}>
      <App />
    </HarnessConfigProvider>
  </React.StrictMode>
);
