import { useT } from "@agent-native/core/client/i18n";
import { useState, type ReactNode } from "react";

import {
  useWorkspaceAppLayout,
  type WorkspaceAppLayoutPersistenceError,
} from "../lib/workspace-app-layout";
import { Alert, AlertDescription } from "./ui/alert";
import { Button } from "./ui/button";

const NOTICE_KEYS: Record<WorkspaceAppLayoutPersistenceError, string> = {
  both: "dispatch.pages.appPinSaveFailed",
  workspace: "dispatch.pages.appPinSaveFailed",
  device: "dispatch.pages.appPinSavedToWorkspaceOnly",
};

/** A dismissible notice above the page content. */
export function AppNotice({
  children,
  onDismiss,
}: {
  children: ReactNode;
  onDismiss: () => void;
}) {
  const t = useT();
  return (
    <Alert
      role="status"
      aria-live="polite"
      data-app-notice
      className="flex items-center justify-between gap-3 rounded-none border-x-0 border-t-0 px-3 py-2"
    >
      <AlertDescription
        data-app-notice-message
        className="min-w-0 text-xs text-muted-foreground"
      >
        {children}
      </AlertDescription>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="shrink-0"
        onClick={onDismiss}
      >
        {t("agentChat.chatFirst.dismiss")}
      </Button>
    </Alert>
  );
}

/** The one place a failed app pin save is shown, on every route. */
export function WorkspaceAppLayoutNotice() {
  const t = useT();
  const { persistenceError } = useWorkspaceAppLayout({ hydrate: false });
  const [dismissedWriteId, setDismissedWriteId] = useState<number | null>(null);
  if (!persistenceError || persistenceError.writeId === dismissedWriteId) {
    return null;
  }
  return (
    <AppNotice onDismiss={() => setDismissedWriteId(persistenceError.writeId)}>
      {t(NOTICE_KEYS[persistenceError.scope])}
    </AppNotice>
  );
}
