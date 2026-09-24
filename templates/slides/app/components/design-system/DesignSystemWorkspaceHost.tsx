import {
  DesignSystemWorkspaceProvider,
  designSystemWorkspaceLabels,
} from "@agent-native/core/client/agent-chat";
import { useT } from "@agent-native/core/client/i18n";
import {
  DesignSystemCreation,
  designSystemCreationLabels,
} from "@agent-native/toolkit/design-system-creation";
import { useCallback, useMemo, type ReactNode } from "react";

import {
  creationComponents,
  useDesignSystemCreationActions,
} from "./design-system-creation";
import { uploadDesignSystemSourceFile } from "./design-system-source-upload";

function AddSystemSources({
  systemId,
  onDone,
}: {
  systemId: string;
  onDone: () => void;
}) {
  const t = useT();
  const actions = useDesignSystemCreationActions();
  return (
    <DesignSystemCreation
      labels={designSystemCreationLabels(t)}
      components={creationComponents}
      addingToSystemId={systemId}
      onCreate={actions.onCreate}
      onAddSources={actions.onAddSources}
      onSourcesAdded={onDone}
      onCancel={onDone}
      uploadFile={(file, options) =>
        uploadDesignSystemSourceFile(file, {
          signal: options.signal,
          failureMessage: t("systemCreation.uploadFailed"),
        })
      }
    />
  );
}

export function DesignSystemWorkspaceHost({
  children,
}: {
  children: ReactNode;
}) {
  const t = useT();
  const labels = useMemo(() => designSystemWorkspaceLabels(t), [t]);
  const renderSources = useCallback(
    (systemId: string, onDone: () => void) => (
      <AddSystemSources systemId={systemId} onDone={onDone} />
    ),
    [],
  );
  return (
    <DesignSystemWorkspaceProvider
      ownerApp="slides"
      labels={labels}
      renderSources={renderSources}
    >
      {children}
    </DesignSystemWorkspaceProvider>
  );
}
