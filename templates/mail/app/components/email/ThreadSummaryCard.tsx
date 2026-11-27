import { useT } from "@agent-native/core/client/i18n";
import { buildSettingsRoute } from "@agent-native/core/client/navigation";
import {
  BuilderConnectPopover,
  useBuilderConnectFlow,
} from "@agent-native/toolkit/app/settings";
import type { ConversationSummary } from "@shared/types";
import { IconSparkles, IconX } from "@tabler/icons-react";
import { Link } from "react-router";

import { ActionTooltip } from "@/components/email/ActionTooltip";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export const SUMMARY_KEYS = ["I"] as const;

function errorCodeOf(error: unknown) {
  return error instanceof Error && "errorCode" in error
    ? error.errorCode
    : undefined;
}

function SummaryModelPrompt({ onConnected }: { onConnected: () => void }) {
  const t = useT();
  const flow = useBuilderConnectFlow({
    trackingSource: "mail_thread_summary",
    trackingFlow: "connect_summary_model",
    onConnected,
  });
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-muted-foreground">
        {t("mail.summary.needsModel")}
      </p>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <BuilderConnectPopover flow={flow}>
          <Button
            type="button"
            disabled={flow.connecting}
            aria-busy={flow.connecting}
            className="h-7 px-3 text-xs"
          >
            {flow.connecting
              ? t("mail.accounts.connecting")
              : t("mail.aiFilter.connectBuilder")}
          </Button>
        </BuilderConnectPopover>
        <Link
          to={buildSettingsRoute("keys:secrets:OPENAI_API_KEY")}
          target="_blank"
          rel="noreferrer"
          className="whitespace-nowrap text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          {t("mail.aiFilter.addOpenAiApiKey")}
        </Link>
      </div>
      {flow.error ? (
        <p className="text-xs text-destructive">{flow.error}</p>
      ) : null}
    </div>
  );
}

export function ThreadSummaryCard({
  summary,
  pending,
  error,
  onHide,
  onRetry,
}: {
  summary: ConversationSummary | null;
  pending: boolean;
  error: unknown;
  onHide: () => void;
  onRetry: () => void;
}) {
  const t = useT();
  const code = error ? errorCodeOf(error) : undefined;

  const failure = !error ? null : code === "no_ai_model" ? (
    <SummaryModelPrompt onConnected={onRetry} />
  ) : (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <p className="text-sm text-muted-foreground">
        {summary ? t("mail.summary.refreshFailed") : t("mail.summary.failed")}
      </p>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-xs"
        onClick={onRetry}
      >
        {t("mail.error.tryAgain")}
      </Button>
    </div>
  );

  let body;
  if (summary) {
    body = (
      <>
        <p className={cn(summary.points.length > 0 && "font-medium")}>
          {summary.line}
        </p>
        {summary.points.length > 0 ? (
          <ul className="mt-1.5 list-disc space-y-1 pl-4 marker:text-muted-foreground/60">
            {summary.points.map((point, index) => (
              <li key={index}>{point}</li>
            ))}
          </ul>
        ) : null}
        {failure ? <div className="mt-2">{failure}</div> : null}
      </>
    );
  } else if (pending) {
    body = (
      <div className="space-y-2 py-0.5" aria-hidden>
        <Skeleton className="h-3.5 w-11/12" />
        <Skeleton className="h-3.5 w-4/5" />
        <Skeleton className="h-3.5 w-2/3" />
      </div>
    );
  } else if (failure) {
    body = failure;
  } else {
    return null;
  }

  return (
    <section
      aria-label={t("mail.summary.label")}
      aria-busy={pending}
      className="group relative flex gap-2.5 rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5 text-sm text-foreground"
    >
      <IconSparkles
        className={cn(
          "mt-0.5 h-4 w-4 shrink-0 text-muted-foreground",
          pending && "animate-pulse",
        )}
        aria-hidden
      />
      <div
        className={cn(
          "min-w-0 flex-1 pr-6 transition-opacity",
          pending && summary && "opacity-60",
        )}
      >
        {body}
      </div>
      <span className="sr-only" aria-live="polite">
        {pending ? t("mail.summary.summarizing") : ""}
      </span>
      <ActionTooltip label={t("mail.summary.hide")} keys={SUMMARY_KEYS}>
        <button
          type="button"
          onClick={onHide}
          aria-label={t("mail.summary.hide")}
          className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <IconX className="h-3.5 w-3.5" />
        </button>
      </ActionTooltip>
    </section>
  );
}
