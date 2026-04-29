import type { ReactNode } from "react";
import { LibraryLayout } from "@/components/library/library-layout";
import { HeaderActionsProvider } from "./HeaderActions";

/**
 * Thin wrapper around the existing `LibraryLayout` so the canonical
 * `Layout` import path matches the analytics template. The single-header
 * pattern (left sidebar + agent sidebar + one chrome bar with title +
 * actions + AgentToggleButton) lives inside `LibraryLayout`. This wrapper
 * provides the analytics-style `HeaderActions` slot store so any page can
 * call `useSetPageTitle` / `useSetHeaderActions` from
 * `@/components/layout/HeaderActions` and the slots will be rendered into
 * the existing portal-based slot in `LibraryLayout`.
 */
export function Layout({ children }: { children: ReactNode }) {
  return (
    <HeaderActionsProvider>
      <LibraryLayout>{children}</LibraryLayout>
    </HeaderActionsProvider>
  );
}
