import {
  DesignSystemWorkspaceProvider,
  designSystemWorkspaceLabels,
} from "@agent-native/core/client/agent-chat";
import { useT } from "@agent-native/core/client/i18n";
import { lazy, Suspense, useCallback, useMemo, type ReactNode } from "react";

import { Skeleton } from "@/components/ui/skeleton";

const DesignSystemSetup = lazy(() => import("@/pages/DesignSystemSetup"));

export function DesignSystemWorkspaceHost({
  children,
}: {
  children: ReactNode;
}) {
  const t = useT();
  const labels = useMemo(() => designSystemWorkspaceLabels(t), [t]);
  const renderSources = useCallback(
    (systemId: string, onDone: () => void) => (
      <Suspense fallback={<Skeleton className="h-40 w-full" />}>
        <DesignSystemSetup
          addingToSystemId={systemId}
          onReturnToPrompt={onDone}
          onSourcesAdded={onDone}
        />
      </Suspense>
    ),
    [],
  );
  return (
    <DesignSystemWorkspaceProvider
      ownerApp="design"
      labels={labels}
      renderSources={renderSources}
    >
      {children}
    </DesignSystemWorkspaceProvider>
  );
}
