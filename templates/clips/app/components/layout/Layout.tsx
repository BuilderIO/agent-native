import { HeaderActionsProvider } from "@agent-native/toolkit/app-shell";
import type { ReactNode } from "react";

import { LibraryLayout } from "@/components/library/library-layout";

export function Layout({ children }: { children: ReactNode }) {
  return (
    <HeaderActionsProvider>
      <LibraryLayout>{children}</LibraryLayout>
    </HeaderActionsProvider>
  );
}
