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
  const { data: org } = useOrg();
  const organizationScope = org?.orgId ?? "personal";

  return (
    <DeckProvider key={`${version}:${organizationScope}`}>
      {children}
    </DeckProvider>
  );
}
