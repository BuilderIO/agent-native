import React from "react";
import ReactDOM from "react-dom/client";

import { CommunityApp } from "./CommunityApp";

import "./styles.css";
import type { Template } from "./template-data";

export function mountCommunityApp(template: Template) {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <CommunityApp template={template} />
    </React.StrictMode>,
  );
}
