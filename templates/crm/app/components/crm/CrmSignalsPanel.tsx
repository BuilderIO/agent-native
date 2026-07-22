import { sendToAgentChat } from "@agent-native/core/client/agent-chat";
import { setClientAppState } from "@agent-native/core/client/application-state";
import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { Badge } from "@agent-native/toolkit/ui/badge";
import { Button } from "@agent-native/toolkit/ui/button";
import {
  IconCheck,
  IconExternalLink,
  IconSparkles,
  IconX,
} from "@tabler/icons-react";
import { useState } from "react";

interface Signal {
  id: string;
  label: string;
  quote?: string;
  summary?: string;
  confidence: number;
  reviewStatus: "unreviewed" | "confirmed" | "dismissed";
  startSeconds?: number;
  evidenceId: string;
}

interface SignalList {
  signals: Signal[];
}

interface DelegatedRequest {
  runId: string;
  trackerId?: string;
  kind: "smart" | "summary";
  prompt: string;
}

interface RunResult {
  keywordSignalsCreated: number;
  delegatedRequests: DelegatedRequest[];
}

export function CrmSignalsPanel({
  recordId,
  evidence,
}: {
  recordId: string;
  evidence: Array<{ id: string; url?: string }>;
}) {
  const [reviewingId, setReviewingId] = useState<string>();
  const query = useActionQuery(
    "list-crm-signal-hits" as never,
    { recordId, limit: 50 } as never,
  ) as { data?: SignalList; isLoading: boolean };
  const run = useActionMutation(
    "run-crm-signal-trackers" as never,
  ) as ReturnType<typeof useActionMutation<RunResult, never>>;
  const review = useActionMutation("review-crm-signal" as never);
  const evidenceById = new Map(evidence.map((item) => [item.id, item]));

  const analyze = () => {
    void setClientAppState(
      "crm-signal-selection",
      { recordId, evidenceIds: evidence.map((item) => item.id) },
      { requestSource: "crm-signals" },
    );
    run.mutate(
      {
        recordId,
        evidenceIds: evidence.map((item) => item.id),
        includeSummary: true,
        idempotencyKey: `ui-${recordId}-${Date.now()}`,
      } as never,
      {
        onSuccess: (result) => {
          if (result.delegatedRequests.length) {
            const requests = result.delegatedRequests
              .map((request, index) => {
                const recorder =
                  request.kind === "smart"
                    ? `Use record-crm-smart-signal with runId ${request.runId}, trackerId ${request.trackerId}, recordId ${recordId}, and a stable idempotencyKey for every grounded match.`
                    : `Use record-crm-call-insight once with runId ${request.runId}, recordId ${recordId}, all grounded insights as one bounded batch, and a stable idempotencyKey.`;
                return `Request ${index + 1}\n${request.prompt}\n\n${recorder}`;
              })
              .join("\n\n---\n\n");
            sendToAgentChat({
              message: `Analyze all bounded call evidence requests for CRM record ${recordId}.`,
              context: `${requests}\n\nProcess every request in this single run. Do not return or store a transcript.`,
              submit: true,
              newTab: true,
              background: true,
              openSidebar: false,
            });
          }
        },
      },
    );
  };

  const setReview = (
    signalId: string,
    reviewStatus: "confirmed" | "dismissed",
  ) => {
    setReviewingId(signalId);
    review.mutate({ signalId, reviewStatus } as never, {
      onSettled: () => setReviewingId(undefined),
    });
  };

  return (
    <div className="max-w-3xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Signals</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Evidence-grounded moments and next steps from attached Clips calls.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5"
          disabled={!evidence.length || run.isPending}
          onClick={analyze}
        >
          <IconSparkles className="size-3.5" />
          {run.isPending ? "Preparing…" : "Analyze evidence"}
        </Button>
      </div>
      {!evidence.length ? (
        <p className="mt-4 rounded-lg border border-border/70 bg-card px-4 py-8 text-center text-sm text-muted-foreground">
          Attach a bounded Clips evidence reference before running detectors.
        </p>
      ) : query.data?.signals.length ? (
        <div className="mt-4 divide-y divide-border rounded-lg border border-border/70 bg-card">
          {query.data.signals.map((signal) => {
            const source = evidenceById.get(signal.evidenceId);
            return (
              <article key={signal.id} className="px-4 py-3">
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium">{signal.label}</p>
                      <Badge
                        variant="secondary"
                        className="font-normal capitalize"
                      >
                        {signal.reviewStatus}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {Math.round(signal.confidence)}% confidence
                      </span>
                    </div>
                    {signal.quote ? (
                      <blockquote className="mt-2 border-l-2 border-border pl-3 text-sm leading-6 text-muted-foreground">
                        “{signal.quote}”
                      </blockquote>
                    ) : signal.summary ? (
                      <p className="mt-2 text-sm leading-6 text-muted-foreground">
                        {signal.summary}
                      </p>
                    ) : null}
                    {signal.startSeconds !== undefined ? (
                      <p className="mt-2 text-xs text-muted-foreground">
                        {formatTimestamp(signal.startSeconds)}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {source?.url ? (
                      <Button variant="ghost" size="icon" asChild>
                        <a
                          href={source.url}
                          target="_blank"
                          rel="noreferrer"
                          aria-label="Open call evidence"
                        >
                          <IconExternalLink className="size-4" />
                        </a>
                      </Button>
                    ) : null}
                    {signal.reviewStatus === "unreviewed" ? (
                      <>
                        <Button
                          variant="ghost"
                          size="icon"
                          disabled={reviewingId === signal.id}
                          onClick={() => setReview(signal.id, "confirmed")}
                          aria-label="Confirm signal"
                        >
                          <IconCheck className="size-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          disabled={reviewingId === signal.id}
                          onClick={() => setReview(signal.id, "dismissed")}
                          aria-label="Dismiss signal"
                        >
                          <IconX className="size-4" />
                        </Button>
                      </>
                    ) : null}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <p className="mt-4 rounded-lg border border-border/70 bg-card px-4 py-8 text-center text-sm text-muted-foreground">
          {query.isLoading
            ? "Loading signals…"
            : "No signals yet. Analyze the attached evidence to find grounded moments."}
        </p>
      )}
    </div>
  );
}

function formatTimestamp(value: number) {
  const seconds = Math.max(0, Math.round(value));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
