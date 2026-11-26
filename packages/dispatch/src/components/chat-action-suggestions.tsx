import type {
  ActionSuggestion,
  ActionSuggestionReceipt,
} from "@agent-native/agentkit/protocol";
import { sendToAgentChat } from "@agent-native/core/client/agent-chat";
import {
  actionErrorCode,
  useActionMutation,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useAgentThread } from "@agent-native/toolkit/app/agentkit/react";
import { IconInfoCircle, IconX } from "@tabler/icons-react";
import { useMemo, useRef, useState } from "react";

import {
  ACTION_SUGGESTION_EXECUTION,
  selectTurnActionSuggestions,
  suggestedActionOperations,
  requiresSuggestionReview,
} from "../lib/action-suggestions.js";
import { Button } from "./ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog.js";

function approvalLink(error: unknown): string | undefined {
  if (
    !error ||
    typeof error !== "object" ||
    !("details" in error) ||
    !error.details ||
    typeof error.details !== "object" ||
    !("approvalReview" in error.details)
  )
    return undefined;
  const review = error.details.approvalReview;
  if (
    !review ||
    typeof review !== "object" ||
    !("url" in review) ||
    typeof review.url !== "string"
  )
    return undefined;
  if (!URL.canParse(review.url)) return undefined;
  const url = new URL(review.url);
  const isLocal =
    url.protocol === "http:" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !isLocal) return undefined;
  if (url.username || url.password) return undefined;
  if (!new URLSearchParams(url.hash.slice(1)).has("mcpApproval"))
    return undefined;
  return url.href;
}

function SuggestionOperation({ suggestion }: { suggestion: ActionSuggestion }) {
  const t = useT();
  const { execution } = suggestion;
  if (execution.type === "create-app") {
    return t("dispatch.pages.suggestionCreateAppOperation", {
      defaultValue: "Create app in this workspace",
    });
  }
  if (execution.type === "customize") {
    return (
      <>
        {t("dispatch.pages.suggestionCustomizeOperation", {
          defaultValue: "Customize",
        })}
        {" · "}
        <bdi>{execution.targetAppId}</bdi>
      </>
    );
  }

  const operations = suggestedActionOperations(execution);
  return (
    <>
      <bdi>{suggestion.appId}</bdi>
      {" · "}
      <bdi>{execution.action}</bdi>
      {operations.length > 0 ? (
        <>
          {" · "}
          <bdi>{operations.join(", ")}</bdi>
        </>
      ) : null}
    </>
  );
}

function argumentLabel(key: string): string {
  const label = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ");
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function ReviewValue({ value }: { value: unknown }) {
  const t = useT();
  if (value === null)
    return (
      <>{t("dispatch.pages.suggestionNullValue", { defaultValue: "None" })}</>
    );
  if (value === undefined) return null;
  if (Array.isArray(value))
    return (
      <ul className="list-inside list-disc">
        {value.map((item, index) => (
          <li key={index}>
            <ReviewValue value={item} />
          </li>
        ))}
      </ul>
    );
  if (typeof value === "object")
    return (
      <dl className="space-y-2">
        {Object.entries(value).map(([key, item]) => (
          <div key={key}>
            <dt className="font-medium">{argumentLabel(key)}</dt>
            <dd>
              <ReviewValue value={item} />
            </dd>
          </div>
        ))}
      </dl>
    );
  if (typeof value === "boolean")
    return (
      <>
        {t(
          value
            ? "dispatch.pages.suggestionYesValue"
            : "dispatch.pages.suggestionNoValue",
          {
            defaultValue: value ? "Yes" : "No",
          },
        )}
      </>
    );
  return <span dir="auto">{String(value)}</span>;
}

export function ChatActionSuggestions({ threadId }: { threadId: string }) {
  const thread = useAgentThread(threadId);
  const turn = useMemo(() => selectTurnActionSuggestions(thread), [thread]);
  return turn ? (
    <ActionSuggestionChips
      key={`${threadId}:${turn.runId}`}
      suggestions={turn.suggestions}
    />
  ) : null;
}

export function ActionSuggestionChips({
  suggestions,
}: {
  suggestions: ActionSuggestion[];
}) {
  const t = useT();
  const execution = useActionMutation<
    ActionSuggestionReceipt,
    { suggestion: ActionSuggestion }
  >(ACTION_SUGGESTION_EXECUTION, { uiOnly: true, retry: false });
  const executing = useRef(false);
  const [handled, setHandled] = useState<Set<string>>(new Set());
  const [pendingId, setPendingId] = useState<string>();
  const [review, setReview] = useState<ActionSuggestion>();
  const [receipt, setReceipt] = useState<ActionSuggestionReceipt>();
  const [failure, setFailure] = useState<{
    approval: boolean;
    url: string | undefined;
  }>();

  function hide(suggestionId: string) {
    setHandled((current) => new Set(current).add(suggestionId));
  }

  async function execute(suggestion: ActionSuggestion) {
    if (executing.current || handled.has(suggestion.id)) return;
    executing.current = true;
    setPendingId(suggestion.id);
    setReceipt(undefined);
    setFailure(undefined);
    try {
      const result = await execution.mutateAsync({ suggestion });
      if (result.suggestionId !== suggestion.id)
        throw new Error("Mismatched suggestion receipt");
      if (
        result.status === "handoff" &&
        result.outcome === "local-app-creation"
      ) {
        sendToAgentChat({
          message: result.prompt,
          submit: true,
          type: "code",
          newTab: true,
          reuseEmptyTab: true,
        });
      }
      hide(suggestion.id);
      setReceipt(result);
    } catch (error) {
      hide(suggestion.id);
      const approval = actionErrorCode(error) === "approval_required";
      setFailure({ approval, url: approval ? approvalLink(error) : undefined });
    } finally {
      executing.current = false;
      setPendingId(undefined);
    }
  }

  const visible = suggestions.filter(
    (suggestion) => !handled.has(suggestion.id),
  );
  if (!visible.length && !receipt && !failure) return null;
  const candidateUrl = receipt && "url" in receipt ? receipt.url : undefined;
  const parsedUrl =
    candidateUrl && URL.canParse(candidateUrl)
      ? new URL(candidateUrl)
      : undefined;
  const receiptUrl =
    parsedUrl &&
    !parsedUrl.username &&
    !parsedUrl.password &&
    (parsedUrl.protocol === "https:" ||
      (parsedUrl.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(parsedUrl.hostname)))
      ? parsedUrl.href
      : undefined;

  return (
    <div className="flex flex-wrap items-center gap-2 py-2">
      {visible.map((suggestion) => (
        <div
          key={suggestion.id}
          className="inline-flex max-w-full items-center rounded-full border border-border"
        >
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-auto min-w-0 flex-col items-start gap-0 rounded-l-full rounded-r-none py-1.5 text-left whitespace-normal"
            title={suggestion.rationale}
            disabled={pendingId !== undefined}
            aria-busy={pendingId === suggestion.id}
            onClick={() => {
              if (requiresSuggestionReview(suggestion)) setReview(suggestion);
              else void execute(suggestion);
            }}
          >
            <span dir="auto">{suggestion.label}</span>
            <span className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
              <SuggestionOperation suggestion={suggestion} />
            </span>
          </Button>
          {!requiresSuggestionReview(suggestion) ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="rounded-none px-2 text-muted-foreground"
              aria-label={t("dispatch.pages.reviewActionSuggestionLabel", {
                defaultValue: "Review {{label}}",
                label: suggestion.label,
              })}
              disabled={pendingId !== undefined}
              onClick={() => setReview(suggestion)}
            >
              <IconInfoCircle size={14} aria-hidden="true" />
            </Button>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="rounded-l-none rounded-r-full px-2 text-muted-foreground"
            aria-label={t("dispatch.pages.dismissActionSuggestion", {
              defaultValue: "Dismiss {{label}}",
              label: suggestion.label,
            })}
            disabled={pendingId === suggestion.id}
            onClick={() => hide(suggestion.id)}
          >
            <IconX size={14} aria-hidden="true" />
          </Button>
        </div>
      ))}
      <Dialog
        open={review !== undefined}
        onOpenChange={(open) => {
          if (!open) setReview(undefined);
        }}
      >
        {review ? (
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {t("dispatch.pages.reviewActionSuggestionTitle", {
                  defaultValue: "Review suggested action",
                })}
              </DialogTitle>
              <DialogDescription>
                <SuggestionOperation suggestion={review} />
              </DialogDescription>
            </DialogHeader>
            <div className="max-h-[50vh] overflow-auto rounded-md border border-border p-3 text-sm whitespace-pre-wrap [overflow-wrap:anywhere]">
              {review.execution.type === "action" ? (
                <dl className="space-y-2">
                  <div>
                    <dt className="font-medium">
                      {t("dispatch.pages.suggestionActionLabel", {
                        defaultValue: "Action",
                      })}
                    </dt>
                    <dd dir="auto">{argumentLabel(review.execution.action)}</dd>
                  </div>
                  <div>
                    <dt className="font-medium">
                      {t("dispatch.pages.suggestionAppLabel", {
                        defaultValue: "App",
                      })}
                    </dt>
                    <dd dir="auto">{review.appId}</dd>
                  </div>
                  {Object.entries(review.execution.params).map(
                    ([key, item]) => (
                      <div key={key}>
                        <dt className="font-medium">{argumentLabel(key)}</dt>
                        <dd>
                          <ReviewValue value={item} />
                        </dd>
                      </div>
                    ),
                  )}
                </dl>
              ) : (
                <span dir="auto">
                  {review.execution.type === "customize"
                    ? review.execution.editSpec
                    : review.execution.domainSpec}
                </span>
              )}
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setReview(undefined)}
              >
                {t("dispatch.pages.cancelActionSuggestion", {
                  defaultValue: "Cancel",
                })}
              </Button>
              <Button
                type="button"
                disabled={pendingId !== undefined}
                onClick={() => {
                  setReview(undefined);
                  void execute(review);
                }}
              >
                {t("dispatch.pages.runActionSuggestion", {
                  defaultValue: "Run action",
                })}
              </Button>
            </DialogFooter>
          </DialogContent>
        ) : null}
      </Dialog>
      {receipt ? (
        <span role="status" className="text-sm text-muted-foreground">
          {receiptUrl ? (
            <a
              className="underline"
              href={receiptUrl}
              target="_blank"
              rel="noreferrer"
            >
              {receipt.outcome === "action-completed"
                ? t("dispatch.pages.openExistingApp", {
                    defaultValue: "Open app",
                  })
                : t("dispatch.pages.openInBuilder", {
                    defaultValue: "Open in Builder",
                  })}
            </a>
          ) : receipt.status === "accepted" ? (
            t("dispatch.pages.actionSuggestionAccepted", {
              defaultValue: "Suggestion accepted.",
            })
          ) : (
            t("dispatch.pages.actionSuggestionContinueInCode", {
              defaultValue: "Continue in Code.",
            })
          )}
        </span>
      ) : null}
      {failure ? (
        <span role="alert" className="text-sm text-destructive">
          {failure.url ? (
            <a
              className="underline"
              href={failure.url}
              target="_blank"
              rel="noreferrer"
            >
              {t("dispatch.pages.reviewActionSuggestionApproval", {
                defaultValue: "Review approval",
              })}
            </a>
          ) : failure.approval ? (
            t("dispatch.pages.actionSuggestionApprovalRequired", {
              defaultValue: "Approval is required for this action.",
            })
          ) : (
            t("dispatch.pages.actionSuggestionUnconfirmed", {
              defaultValue:
                "Could not confirm the suggested action. Check the app before trying again.",
            })
          )}
        </span>
      ) : null}
    </div>
  );
}
