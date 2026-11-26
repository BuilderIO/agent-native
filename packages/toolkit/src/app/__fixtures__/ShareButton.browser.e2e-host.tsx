import "./ShareButton.browser.css";
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { createRoot } from "react-dom/client";

import { TooltipProvider } from "../../ui/tooltip.js";
import { createToolkitI18nCatalog } from "../i18n.js";
import { ShareButton } from "../sharing/ShareButton.js";

const root = document.getElementById("root");
if (!root) throw new Error("Missing test root");
createRoot(root).render(
  <QueryClientProvider client={new QueryClient()}>
    <AgentNativeI18nProvider
      catalogs={[createToolkitI18nCatalog({ messages: {} })]}
    >
      <TooltipProvider>
        <ShareButton
          resourceType="document"
          resourceId="test"
          resourceTitle="Test"
          defaultOpen
          autoFocusInvite
          hideTrigger
        />
      </TooltipProvider>
    </AgentNativeI18nProvider>
  </QueryClientProvider>,
);
