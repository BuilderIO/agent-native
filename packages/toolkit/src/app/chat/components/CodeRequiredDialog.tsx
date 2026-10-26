import {
  BUILDER_AGENT_NOT_CONNECTED_ERROR_CODE,
  isFrameworkRouteError,
  startBuilderAgentsRun,
} from "@agent-native/core/client/agent-chat";
import { useT } from "@agent-native/core/client/i18n";
import {
  IconPackageExport,
  IconCode,
  IconExternalLink,
} from "@tabler/icons-react";
import { useEffect, useState, type ReactNode } from "react";

import { Button } from "../../../ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../../../ui/dialog.js";
import { Skeleton } from "../../../ui/skeleton.js";
import { Spinner } from "../../../ui/spinner.js";
import {
  BuilderConnectPopover as DeferredBuilderConnectPopover,
  useBuilderConnectFlow,
} from "../../settings/index.js";

const DESKTOP_DOWNLOAD_URL = "https://www.agent-native.com/download";

const OPTION_ROW_CLASS =
  "h-auto w-full items-start justify-start gap-3 whitespace-normal p-3 text-start font-normal [&_svg]:size-5";

export interface CodeRequiredDialogProps {
  open: boolean;
  onClose: () => void;
  featureLabel?: string;
}

export function CodeRequiredDialog({
  open,
  onClose,
  featureLabel,
}: CodeRequiredDialogProps) {
  const t = useT();
  const builderFlow = useBuilderConnectFlow({
    provisionAccount: true,
    trackingSource: "code_required_dialog",
    trackingFlow: "background_agent",
  });
  const builderConnected = builderFlow.statusResolved && builderFlow.configured;
  const cloudAgentsAvailable =
    builderFlow.statusResolved &&
    builderFlow.builderEnabled &&
    builderFlow.codeChangeConfigured;
  // An unreadable status falls through to the connect option rather than
  // holding the placeholder forever.
  const statusPending =
    !builderFlow.statusResolved && !builderFlow.statusUnavailable;
  const [submitting, setSubmitting] = useState(false);
  // Builder can accept a run without returning a branch page.
  const [started, setStarted] = useState<{ url: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setSubmitting(false);
      setStarted(null);
      setError(null);
    }
  }, [open]);

  const handleBuilderAgent = async () => {
    if (!builderConnected) {
      window.dispatchEvent(new Event("agent-panel:open-settings"));
      onClose();
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const receipt = await startBuilderAgentsRun({
        userMessage: featureLabel || t("codeRequired.defaultFeature"),
      });
      setStarted({ url: receipt.url });
    } catch (err) {
      setError(
        !isFrameworkRouteError(err)
          ? t("codeRequired.branchError")
          : err.errorCode === BUILDER_AGENT_NOT_CONNECTED_ERROR_CODE
            ? t("agentChat.codeRequired.builderAgentNotConnected")
            : err.kind === "http"
              ? err.serverMessage ||
                t("agentChat.codeRequired.requestFailed", {
                  status: err.status,
                })
              : t("codeRequired.branchError"),
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        className="max-w-[464px] gap-5"
        closeLabel={t("codeRequired.close")}
      >
        <div className="flex items-start gap-3 pe-6">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <IconPackageExport size={20} aria-hidden />
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <DialogTitle className="text-base leading-snug">
              {t("codeRequired.title")}
            </DialogTitle>
            <DialogDescription>
              {featureLabel
                ? t("codeRequired.subtitleWithFeature", {
                    feature: featureLabel,
                  })
                : t("codeRequired.subtitle")}
            </DialogDescription>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Button asChild variant="outline" className={OPTION_ROW_CLASS}>
            <a href={DESKTOP_DOWNLOAD_URL} target="_blank" rel="noreferrer">
              <OptionRowContent
                icon={<IconCode size={20} />}
                title={t("codeRequired.desktopTitle")}
                description={t("codeRequired.desktopDescription")}
              />
            </a>
          </Button>

          {statusPending ? (
            <div
              className="flex items-start gap-3 rounded-md border border-border p-3"
              aria-hidden
            >
              <Skeleton className="size-5 shrink-0" />
              <div className="flex min-w-0 flex-1 flex-col gap-1.5 py-0.5">
                <Skeleton className="h-4 w-2/5" />
                <Skeleton className="h-3 w-11/12" />
                <Skeleton className="h-3 w-3/5" />
              </div>
            </div>
          ) : builderConnected && cloudAgentsAvailable ? (
            <Button
              type="button"
              variant="outline"
              className={OPTION_ROW_CLASS}
              disabled={submitting}
              aria-busy={submitting || undefined}
              onClick={() => void handleBuilderAgent()}
            >
              <OptionRowContent
                icon={
                  submitting ? (
                    <Spinner className="size-5" />
                  ) : (
                    <IconExternalLink size={20} />
                  )
                }
                title={t("codeRequired.builderAgentTitle")}
                description={t("codeRequired.builderAgentDescription")}
              />
            </Button>
          ) : builderConnected ? (
            <div className="flex items-start gap-3 rounded-md border border-border p-3 [&_svg]:size-5">
              <OptionRowContent
                icon={<IconExternalLink size={20} />}
                title={t("codeRequired.codeChangeTitle")}
                description={t("codeRequired.fallbackDetail")}
                badge={t("codeRequired.codeChangeBadge")}
              />
            </div>
          ) : (
            <DeferredBuilderConnectPopover flow={builderFlow}>
              <Button
                type="button"
                variant="outline"
                className={OPTION_ROW_CLASS}
                disabled={builderFlow.connecting}
                aria-busy={builderFlow.connecting || undefined}
              >
                <OptionRowContent
                  icon={
                    builderFlow.connecting ? (
                      <Spinner className="size-5" />
                    ) : (
                      <IconExternalLink size={20} />
                    )
                  }
                  title={t("codeRequired.connectBuilderTitle")}
                  description={t("codeRequired.connectBuilderDescription")}
                  badge={t("codeRequired.setupRequired")}
                />
              </Button>
            </DeferredBuilderConnectPopover>
          )}
        </div>

        {started && (
          <div className="flex flex-col gap-1 rounded-md border border-[hsl(var(--agent-kit-positive)/0.3)] bg-[hsl(var(--agent-kit-positive)/0.08)] p-3">
            <span className="text-sm font-semibold">
              {t("codeRequired.branchCreated")}
            </span>
            {started.url ? (
              <a
                href={started.url}
                target="_blank"
                rel="noopener noreferrer"
                className="break-all text-xs text-primary hover:underline"
              >
                {started.url}
              </a>
            ) : null}
          </div>
        )}

        {error && (
          <p className="text-xs text-destructive" role="alert">
            {error}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

function OptionRowContent({
  icon,
  title,
  description,
  badge,
}: {
  icon: ReactNode;
  title: string;
  description?: string;
  badge?: string;
}) {
  return (
    <>
      <span className="mt-0.5 flex shrink-0 text-primary">{icon}</span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-sm font-semibold text-foreground">{title}</span>
        {description ? (
          <span className="text-xs leading-normal text-muted-foreground">
            {description}
          </span>
        ) : null}
      </span>
      {badge ? (
        <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
          {badge}
        </span>
      ) : null}
    </>
  );
}
