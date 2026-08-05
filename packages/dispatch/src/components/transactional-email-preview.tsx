import { useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { IconAlertTriangle } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";

import {
  fetchEmailPreview,
  type EmailPreview,
} from "../client/transactional-emails";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Skeleton } from "./ui/skeleton";

/**
 * The "core" app id means the email was read from Dispatch's own local
 * catalog (see transactional-email.tsx), not a cross-app fetch, so its
 * preview must render the same way — Dispatch always has the definition
 * registered locally and a cross-app fetch would have no real appPath to hit.
 */
function useEmailPreviewQuery(appId: string, appPath: string, id: string) {
  const isCore = appId === "core";
  const local = useActionQuery<EmailPreview>(
    "render-transactional-email-preview",
    { id },
    { enabled: isCore, retry: false },
  );
  const remote = useQuery({
    queryKey: ["transactional-email-preview", appPath, id],
    queryFn: () => fetchEmailPreview(appPath, id),
    enabled: !isCore,
    retry: false,
  });
  return isCore ? local : remote;
}

export function EmailPreviewPane({
  appId,
  appPath,
  id,
  name,
}: {
  appId: string;
  appPath: string;
  id: string;
  name: string;
}) {
  const t = useT();
  const preview = useEmailPreviewQuery(appId, appPath, id);

  if (preview.isError) {
    return (
      <Alert variant="destructive">
        <IconAlertTriangle className="size-4" />
        <AlertTitle>
          {t("dispatch.transactionalEmail.previewFailed")}
        </AlertTitle>
        <AlertDescription>
          {preview.error instanceof Error
            ? preview.error.message
            : String(preview.error)}
        </AlertDescription>
      </Alert>
    );
  }
  if (preview.isLoading || !preview.data) {
    return <Skeleton className="h-96 w-full" />;
  }
  return (
    <div className="space-y-3">
      <div>
        <div className="text-xs text-muted-foreground">
          {t("dispatch.transactionalEmail.subject")}
        </div>
        <div className="text-sm font-medium text-foreground">
          {preview.data.subject}
        </div>
      </div>
      {/* sandbox="" (no allow-scripts) keeps arbitrary email HTML from
          running script in the Dispatch origin. */}
      <iframe
        title={t("dispatch.transactionalEmail.previewFrameTitle", { name })}
        sandbox=""
        srcDoc={preview.data.html}
        // guard:allow-raw-color — the frame previews email HTML, which renders on white in mail clients regardless of app theme.
        className="h-96 w-full rounded-xl border bg-white"
      />
    </div>
  );
}
