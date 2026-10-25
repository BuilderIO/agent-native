import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import CaptureSyncProvider from "@/components/CaptureSyncProvider";

const queryClient = new QueryClient();

export default function AppProviders({ children }: PropsWithChildren) {
  return (
    <AgentNativeI18nProvider persistPreference={false}>
      <QueryClientProvider client={queryClient}>
        <SafeAreaProvider>
          <KeyboardProvider>
            <CaptureSyncProvider>{children}</CaptureSyncProvider>
          </KeyboardProvider>
        </SafeAreaProvider>
      </QueryClientProvider>
    </AgentNativeI18nProvider>
  );
}
