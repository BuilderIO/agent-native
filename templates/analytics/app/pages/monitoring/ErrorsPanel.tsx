/**
 * Error capture panel — OWNED BY THE ERROR CAPTURE FEATURE.
 *
 * Sentry-style exception triage below the Monitoring tab bar. The issue list
 * and per-issue detail are switched via the `?issue=<id>` query param (shareable
 * + agent-deep-linkable) and the selection is mirrored into `application_state`
 * so the agent knows which error the user is looking at. Data flows through the
 * error-capture actions; `useChangeVersions(["error-issues"])` keeps the UI
 * fresh as new captures and agent edits land.
 */
import {
  setClientAppState,
  useActionMutation,
  useActionQuery,
  useChangeVersions,
} from "@agent-native/core/client";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { toast } from "sonner";

import { fmt, useErrorsT } from "./errors/i18n";
import { IssueDetail } from "./errors/IssueDetail";
import { IssueList } from "./errors/IssueList";
import type {
  ErrorIssueDetail,
  ErrorIssueSummary,
  IssueStatus,
  StatusFilter,
} from "./errors/types";

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

export function ErrorsPanel() {
  const t = useErrorsT();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = searchParams.get("issue");

  const [status, setStatus] = useState<StatusFilter>("unresolved");
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 250);

  const sync = useChangeVersions(["error-issues", "action"]);

  const queryArgs = useMemo(
    () => ({
      status,
      query: debouncedSearch.trim() || undefined,
      limit: 100,
    }),
    [status, debouncedSearch],
  );

  const { data, isLoading, isFetching, error, refetch } = useActionQuery(
    "list-error-issues",
    queryArgs,
    { staleTime: 10_000 },
  );

  const resolveIssue = useActionMutation("resolve-error-issue");
  const sendTest = useActionMutation("capture-test-error");

  const issues = useMemo(() => (Array.isArray(data) ? data : []), [data]);

  // Refresh list + detail when a capture or agent edit records an
  // "error-issues" change (useDbSync bumps the version this hook reads).
  useEffect(() => {
    queryClient.invalidateQueries({
      queryKey: ["action", "list-error-issues"],
    });
    queryClient.invalidateQueries({ queryKey: ["action", "get-error-issue"] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sync]);

  const selectedIssue = useMemo(
    () => issues.find((issue) => issue.id === selectedId) ?? null,
    [issues, selectedId],
  );

  // Mirror the current selection into application_state for the agent.
  useEffect(() => {
    const value = selectedIssue
      ? {
          view: "errors",
          issueId: selectedIssue.id,
          title: selectedIssue.title,
          status: selectedIssue.status,
        }
      : selectedId
        ? { view: "errors", issueId: selectedId }
        : { view: "errors" };
    void setClientAppState("monitoring", value).catch(() => {});
  }, [selectedIssue, selectedId]);

  const selectIssue = (id: string | null) => {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        if (id) params.set("issue", id);
        else params.delete("issue");
        return params;
      },
      { replace: false },
    );
  };

  const applyStatusToCaches = (id: string, nextStatus: IssueStatus) => {
    queryClient.setQueriesData<ErrorIssueSummary[]>(
      { queryKey: ["action", "list-error-issues"] },
      (old) =>
        Array.isArray(old)
          ? old.map((issue) =>
              issue.id === id ? { ...issue, status: nextStatus } : issue,
            )
          : old,
    );
    queryClient.setQueriesData<ErrorIssueDetail>(
      { queryKey: ["action", "get-error-issue"] },
      (old) =>
        old && old.issue?.id === id
          ? { ...old, issue: { ...old.issue, status: nextStatus } }
          : old,
    );
  };

  const handleSetStatus = async (id: string, nextStatus: IssueStatus) => {
    applyStatusToCaches(id, nextStatus);
    try {
      await resolveIssue.mutateAsync({ id, status: nextStatus });
      toast.success(
        nextStatus === "resolved"
          ? t.resolvedToast
          : nextStatus === "ignored"
            ? t.ignoredToast
            : t.reopenedToast,
      );
    } catch (err) {
      queryClient.invalidateQueries({
        queryKey: ["action", "list-error-issues"],
      });
      queryClient.invalidateQueries({
        queryKey: ["action", "get-error-issue"],
      });
      toast.error(
        fmt(t.updateFailed, {
          message: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  };

  const handleSendTestError = async () => {
    try {
      await sendTest.mutateAsync({});
      toast.success(t.testSentToast);
      await refetch();
    } catch (err) {
      toast.error(
        fmt(t.testFailed, {
          message: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  };

  if (selectedId) {
    return (
      <IssueDetail
        issueId={selectedId}
        fallback={selectedIssue ?? undefined}
        onBack={() => selectIssue(null)}
        onSetStatus={(next) => handleSetStatus(selectedId, next)}
        pendingStatus={resolveIssue.isPending}
      />
    );
  }

  return (
    <IssueList
      issues={issues}
      isLoading={isLoading}
      status={status}
      onStatusChange={setStatus}
      search={search}
      onSearchChange={setSearch}
      onRefresh={() => void refetch()}
      isFetching={isFetching}
      onSelect={selectIssue}
      onSendTestError={handleSendTestError}
      sendingTest={sendTest.isPending}
      error={error ? error.message : null}
    />
  );
}
