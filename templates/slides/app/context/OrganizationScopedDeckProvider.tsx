import { useOrg } from "@agent-native/core/client/org";
import { useRef, type ReactNode } from "react";

import { DeckProvider, markOrgSwitchUnmount } from "@/context/DeckContext";

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
    <OrgKeyedDeckProvider
      version={version}
      organizationScope={organizationScope}
    >
      {children}
    </OrgKeyedDeckProvider>
  );
}

// Separate component so the ref tracks the committed scope independent of the
// parent's loading gate re-renders.
function OrgKeyedDeckProvider({
  children,
  version,
  organizationScope,
}: {
  children: ReactNode;
  version: number;
  organizationScope: string;
}) {
  const prevScopeRef = useRef(organizationScope);

  if (prevScopeRef.current !== organizationScope) {
    // Org scope changed: signal that the imminent DeckProvider unmount is an
    // org switch so its cleanup cancels pending ops instead of flushing them.
    // This runs during render (synchronously before React's commit phase), which
    // guarantees the flag is set before the DeckProvider cleanup executes.
    markOrgSwitchUnmount();
    prevScopeRef.current = organizationScope;
  }

  return (
    <DeckProvider key={`${version}:${organizationScope}`}>
      {children}
    </DeckProvider>
  );
}
