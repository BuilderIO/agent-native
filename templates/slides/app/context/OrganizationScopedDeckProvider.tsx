import { useOrg } from "@agent-native/core/client/org";
import type { ReactNode } from "react";

import { DeckProvider } from "@/context/DeckContext";

export function OrganizationScopedDeckProvider({
  children,
  version,
}: {
  children: ReactNode;
  version: number;
}) {
  const { data: org, isLoading } = useOrg();

  // Don't render until org is known — avoids mounting with a "personal"
  // placeholder key that immediately changes once the org query resolves,
  // which would double-mount DeckProvider and trigger duplicate deck fetches.
  if (isLoading) return null;

  const organizationScope = org?.orgId ?? "personal";
  return (
    <DeckProvider key={`${version}:${organizationScope}`}>
      {children}
    </DeckProvider>
  );
}
