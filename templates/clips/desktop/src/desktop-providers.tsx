import { createAgentNativeQueryClient } from "@agent-native/core/client/hooks";
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

import { i18nCatalog } from "../../app/i18n";

// Every desktop window renders under these; the meeting pill's AgentKit chat
// reads React Query and throws at mount without a client.
export function DesktopProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => createAgentNativeQueryClient());
  return (
    <QueryClientProvider client={queryClient}>
      <AgentNativeI18nProvider catalog={i18nCatalog} persistPreference={false}>
        {children}
      </AgentNativeI18nProvider>
    </QueryClientProvider>
  );
}
