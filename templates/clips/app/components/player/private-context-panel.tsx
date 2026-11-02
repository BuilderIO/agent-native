import { captureClientException } from "@agent-native/core/client/analytics";
import { useFeatureFlag } from "@agent-native/core/client/feature-flags";
import {
  callAction,
  deleteClientAppState,
  setClientAppState,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useFormatters, useT } from "@agent-native/core/client/i18n";
import { writeClipboardText } from "@agent-native/toolkit/clipboard";
import { ShareAgentsSection } from "@agent-native/toolkit/sharing";
import type { AppActivityEvent } from "@shared/app-activity";
import type { DiagnosticScope } from "@shared/diagnostic-context";
import { CLIPS_DIAGNOSTIC_AGENT_GRANTS_FLAG } from "@shared/feature-flags";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { diagnosticEventMediaTime } from "@/lib/diagnostic-media-time";

export interface PrivateDiagnosticContext {
  canManage: boolean;
  context: {
    id: string;
    contextVersion: number;
    recordingStartedAt: string;
    pauses?: Array<{ from: string; to: string }>;
    captured?:
      | "ready"
      | "partial"
      | "disabled"
      | "unsupported"
      | "failed"
      | "collecting";
    requestedWindow?: { from: string; to: string };
    coverage?: Array<{ documentId: string; from: string; to: string }>;
    gaps?: Array<{ from: string; to: string; reason: string }>;
    droppedEvents?: number;
    expiresAt: string;
    failureCode?: string;
  };
  events?: AppActivityEvent[];
  watched?: Record<string, unknown>;
  watchedAtMs?: number;
  pendingAtMs?: number;
  summary?: Record<string, unknown>;
  sources?: Array<{ documentId: string; app: string; build: string }>;
  collectionOutcomes?: Array<{ atMs: number; status: string; reason?: string }>;
  browserDiagnostics?: Record<string, unknown>;
  hostMetadata?: Record<string, unknown>;
  pending?: unknown[];
  truncated?: boolean;
  nextStart?: number;
}

interface DiagnosticGrant {
  id: string;
  label: string;
  scopes: DiagnosticScope[];
  expiresAt: string;
  revokedAt: string | null;
}

const CATEGORIES = [
  ["summary", "summary"],
  ["events", "events"],
  ["state", "state"],
  ["browser-diagnostics", "browser"],
  ["host-metadata", "host"],
] as const;

export function PrivateContextPanel({
  data,
  recordingId,
  durationMs,
  onSeek,
}: {
  data: PrivateDiagnosticContext;
  recordingId: string;
  durationMs: number;
  onSeek?: (ms: number) => void;
}) {
  const t = useT();
  const format = useFormatters();
  const instant = (value: string) =>
    format.formatDate(value, { dateStyle: "short", timeStyle: "medium" });
  const queryClient = useQueryClient();
  const grantsEnabled = useFeatureFlag(CLIPS_DIAGNOSTIC_AGENT_GRANTS_FLAG.key);
  const [label, setLabel] = useState("");
  const [ttlHours, setTtlHours] = useState(2);
  const [expired, setExpired] = useState(false);
  const [scopes, setScopes] = useState<DiagnosticScope[]>([
    "summary",
    "events",
  ]);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [email, setEmail] = useState("");
  const [url, setUrl] = useState<string | null>(null);
  const [currentGrant, setCurrentGrant] = useState<{
    id: string;
    expiresAt: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [start, setStart] = useState(0);
  const contextId = data.context.id;
  const invalidWindow = !!from && !!to && Number(from) > Number(to);
  const grants = useActionQuery<{ grants: DiagnosticGrant[] }>(
    "list-recording-diagnostic-grants",
    { contextId },
    { enabled: data.canManage, gcTime: 0, refetchInterval: 15_000 },
  );
  const shares = useActionQuery<{ shares: Array<{ email: string }> }>(
    "list-recording-diagnostic-shares",
    { contextId },
    { enabled: data.canManage, gcTime: 0, refetchInterval: 15_000 },
  );
  const page = useActionQuery<PrivateDiagnosticContext>(
    "get-recording-diagnostic-context",
    {
      contextId,
      start,
      maxEvents: 100,
      scopes,
      ...(from ? { fromMs: Number(from) } : {}),
      ...(to ? { toMs: Number(to) } : {}),
    },
    {
      enabled: scopes.length > 0 && !expired && !invalidWindow,
      gcTime: 0,
      refetchInterval: 15_000,
    },
  );

  const preview = invalidWindow ? undefined : page.data;
  const nextStart = preview?.nextStart;
  useEffect(() => {
    if (!currentGrant) return;
    const remaining = Date.parse(currentGrant.expiresAt) - Date.now();
    const listedGrant = grants.data?.grants.find(
      (grant) => grant.id === currentGrant.id,
    );
    if (remaining <= 0 || listedGrant?.revokedAt) {
      setUrl(null);
      setCurrentGrant(null);
      return;
    }
    const timer = window.setTimeout(() => {
      setUrl(null);
      setCurrentGrant(null);
    }, remaining);
    return () => window.clearTimeout(timer);
  }, [currentGrant, grants.data]);

  useEffect(() => {
    void setClientAppState("diagnostic-context-selection", {
      recordingId,
      contextId,
      contextVersion: data.context.contextVersion,
      scopes,
      fromMs: from ? Number(from) : null,
      toMs: to ? Number(to) : null,
    }).catch(captureClientException);
  }, [contextId, data.context.contextVersion, from, recordingId, scopes, to]);
  useEffect(() => {
    let timer: number;
    const checkExpiry = () => {
      const remaining = Date.parse(data.context.expiresAt) - Date.now();
      if (remaining <= 0) {
        setUrl(null);
        setExpired(true);
        queryClient.removeQueries({
          queryKey: ["action", "get-recording-diagnostic-context"],
        });
        queryClient.removeQueries({
          queryKey: ["action", "list-recording-diagnostic-grants"],
        });
      } else {
        timer = window.setTimeout(checkExpiry, Math.min(remaining, 86_400_000));
      }
    };
    setExpired(false);
    checkExpiry();
    return () => {
      window.clearTimeout(timer);
    };
  }, [data.context.expiresAt, queryClient]);
  useEffect(
    () => () => {
      setUrl(null);
      void deleteClientAppState("diagnostic-context-selection").catch(
        captureClientException,
      );
    },
    [contextId],
  );

  async function mutate(operation: () => Promise<unknown>) {
    setBusy(true);
    try {
      await operation();
      await queryClient.invalidateQueries({
        queryKey: ["action", "list-recording-diagnostic-grants"],
      });
      await queryClient.invalidateQueries({
        queryKey: ["action", "get-recording-diagnostic-context"],
      });
      await shares.refetch();
      setUrl(null);
    } catch {
      toast.error(t("privateContext.actionFailed"));
    } finally {
      setBusy(false);
    }
  }

  if (expired || (page.isError && !invalidWindow))
    return (
      <p className="p-3 text-sm" role="alert">
        {t("privateContext.unavailable")}
      </p>
    );

  return (
    <div className="grid gap-3 overflow-auto p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span>
          {data.context.captured
            ? t(`privateContext.${data.context.captured}`)
            : t("privateContext.title")}
        </span>
        <span className="text-xs text-muted-foreground">
          {t("privateContext.saved")}
        </span>
      </div>
      {data.context.failureCode ? (
        <p role="status" className="text-xs text-muted-foreground">
          <code>{data.context.failureCode}</code>
        </p>
      ) : null}
      <div className="text-xs text-muted-foreground">
        {data.context.requestedWindow ? (
          <p>
            {t("privateContext.interval", {
              from: instant(data.context.requestedWindow.from),
              to: instant(data.context.requestedWindow.to),
            })}
          </p>
        ) : null}
        {data.context.coverage?.map((span, index) => (
          <p key={`${span.documentId}:${index}`}>
            {t("privateContext.coverage", {
              from: instant(span.from),
              to: instant(span.to),
            })}
          </p>
        ))}
        {data.context.gaps?.map((gap, index) => (
          <p key={index}>
            {t("privateContext.gap", { reason: gap.reason })}{" "}
            {instant(gap.from)} – {instant(gap.to)}
          </p>
        ))}
        {(data.context.droppedEvents ?? 0) > 0 ? (
          <p>
            {t("privateContext.dropped", { count: data.context.droppedEvents })}
          </p>
        ) : null}
        <p>
          {t("privateContext.expires", {
            date: instant(data.context.expiresAt),
          })}
        </p>
      </div>
      <details>
        <summary>{t("privateContext.categories")}</summary>
        <div className="mt-2 grid gap-2">
          {" "}
          {CATEGORIES.map(([scope, key]) => (
            <label key={scope} className="flex items-center gap-2">
              <Checkbox
                checked={scopes.includes(scope)}
                onCheckedChange={(checked) =>
                  setScopes((current) =>
                    checked
                      ? [...current, scope]
                      : current.filter((value) => value !== scope),
                  )
                }
              />
              {t(`privateContext.${key}`)}
            </label>
          ))}
        </div>
      </details>
      <div className="flex gap-2">
        <label className="min-w-0 flex-1 text-xs">
          {t("privateContext.from")}
          <Input
            type="number"
            value={from}
            onChange={(event) => {
              setFrom(event.target.value);
              setStart(0);
            }}
          />
        </label>
        <label className="min-w-0 flex-1 text-xs">
          {t("privateContext.to")}
          <Input
            type="number"
            value={to}
            onChange={(event) => {
              setTo(event.target.value);
              setStart(0);
            }}
          />
        </label>
      </div>
      {invalidWindow ? (
        <p role="alert">{t("privateContext.invalidWindow")}</p>
      ) : preview?.events?.length === 0 ? (
        <p>{t("privateContext.noEvents")}</p>
      ) : null}
      {preview?.events?.map((event, index) => {
        const offset =
          data.context.pauses && onSeek
            ? diagnosticEventMediaTime(event, {
                recordingStartedAt: data.context.recordingStartedAt,
                pauses: data.context.pauses,
                durationMs,
              })
            : null;
        return (
          <button
            type="button"
            disabled={offset === null}
            className="flex gap-2 rounded px-2 py-1 text-start enabled:hover:bg-muted disabled:cursor-default"
            key={`${event.documentId}:${event.seq}:${index}`}
            onClick={() => {
              if (offset !== null) onSeek?.(offset);
            }}
          >
            <span className="tabular-nums text-muted-foreground">
              {event.elapsedMs} ms
            </span>
            <span>
              {event.type} {event.name}
            </span>
          </button>
        );
      })}
      {preview?.truncated && nextStart !== undefined ? (
        <Button variant="outline" size="sm" onClick={() => setStart(nextStart)}>
          {t("privateContext.nextPage")}
        </Button>
      ) : null}
      {preview?.sources?.length || preview?.collectionOutcomes?.length ? (
        <details>
          <summary>{t("privateContext.collectionDetails")}</summary>
          <pre className="overflow-auto whitespace-pre-wrap text-xs">
            {JSON.stringify(
              {
                sources: preview.sources,
                outcomes: preview.collectionOutcomes,
              },
              null,
              2,
            )}
          </pre>
        </details>
      ) : null}
      {preview?.summary ? (
        <details>
          <summary>{t("privateContext.summary")}</summary>
          <pre className="overflow-auto whitespace-pre-wrap text-xs">
            {JSON.stringify(preview.summary, null, 2)}
          </pre>
        </details>
      ) : null}
      {preview?.watched || preview?.pending?.length ? (
        <details>
          <summary>{t("privateContext.state")}</summary>
          <pre className="overflow-auto whitespace-pre-wrap text-xs">
            {JSON.stringify(
              {
                watchedAtMs: preview.watchedAtMs,
                watched: preview.watched,
                pendingAtMs: preview.pendingAtMs,
                pending: preview.pending,
              },
              null,
              2,
            )}
          </pre>
        </details>
      ) : null}
      {preview?.browserDiagnostics ? (
        <details>
          <summary>{t("privateContext.browser")}</summary>
          <pre className="overflow-auto whitespace-pre-wrap text-xs">
            {JSON.stringify(preview.browserDiagnostics, null, 2)}
          </pre>
        </details>
      ) : null}
      {preview?.hostMetadata ? (
        <details>
          <summary>{t("privateContext.host")}</summary>
          <pre className="overflow-auto whitespace-pre-wrap text-xs">
            {JSON.stringify(preview.hostMetadata, null, 2)}
          </pre>
        </details>
      ) : null}
      {data.canManage && grantsEnabled ? (
        <ShareAgentsSection label={t("privateContext.agent")}>
          <div className="grid gap-2">
            <Input
              aria-label={t("privateContext.label")}
              placeholder={t("privateContext.label")}
              value={label}
              onChange={(event) => setLabel(event.target.value)}
            />
            <label className="text-xs">
              {t("privateContext.ttl")}
              <Input
                type="number"
                min={1}
                max={168}
                value={ttlHours}
                onChange={(event) =>
                  setTtlHours(
                    Math.max(1, Math.min(168, Number(event.target.value) || 1)),
                  )
                }
              />
            </label>
            <Button
              size="sm"
              disabled={
                busy || !label.trim() || !scopes.length || invalidWindow
              }
              onClick={() => {
                setBusy(true);
                void callAction<{
                  grantId: string;
                  url: string;
                  expiresAt: string;
                }>("create-recording-diagnostic-grant", {
                  contextId,
                  label,
                  scopes,
                  ttlSeconds: ttlHours * 3600,
                  ...(from ? { fromMs: Number(from) } : {}),
                  ...(to ? { toMs: Number(to) } : {}),
                })
                  .then((result) => {
                    setUrl(result.url);
                    setCurrentGrant({
                      id: result.grantId,
                      expiresAt: result.expiresAt,
                    });
                    return grants.refetch();
                  })
                  .catch(() => toast.error(t("privateContext.actionFailed")))
                  .finally(() => setBusy(false));
              }}
            >
              {t("privateContext.create")}
            </Button>
            {url ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => void writeClipboardText(url)}
              >
                {t("privateContext.copy")}
              </Button>
            ) : null}
            {grants.data?.grants
              .filter((grant) => !grant.revokedAt)
              .map((grant) => (
                <div
                  key={grant.id}
                  className="flex items-center justify-between gap-2"
                >
                  <span>
                    {grant.label}
                    <span className="block text-xs text-muted-foreground">
                      {t("privateContext.expires", {
                        date: instant(grant.expiresAt),
                      })}
                    </span>
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() =>
                      void mutate(() =>
                        callAction("revoke-recording-diagnostic-grant", {
                          grantId: grant.id,
                        }),
                      )
                    }
                  >
                    {t("privateContext.revoke")}
                  </Button>
                </div>
              ))}
          </div>
        </ShareAgentsSection>
      ) : null}
      {data.canManage ? (
        <details>
          <summary>{t("privateContext.share")}</summary>
          <div className="mt-2 grid gap-2">
            <div className="flex gap-2">
              <Input
                type="email"
                aria-label={t("privateContext.email")}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
              <Button
                size="sm"
                disabled={busy || !email.trim()}
                onClick={() =>
                  void mutate(() =>
                    callAction("share-recording-diagnostic-context", {
                      contextId,
                      email,
                    }),
                  )
                }
              >
                {t("privateContext.share")}
              </Button>
            </div>
            {shares.data?.shares.map((share) => (
              <div
                key={share.email}
                className="flex items-center justify-between gap-2"
              >
                <span className="truncate">{share.email}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    void mutate(() =>
                      callAction("unshare-recording-diagnostic-context", {
                        contextId,
                        email: share.email,
                      }),
                    )
                  }
                >
                  {t("privateContext.revoke")}
                </Button>
              </div>
            ))}
          </div>
        </details>
      ) : null}
      {data.canManage ? (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="ghost" size="sm" className="text-destructive">
              {t("privateContext.remove")}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("privateContext.remove")}</AlertDialogTitle>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>
                {t("privateContext.cancel")}
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={() =>
                  void mutate(async () => {
                    await callAction("remove-recording-diagnostic-context", {
                      contextId,
                    });
                    setExpired(true);
                  })
                }
              >
                {t("privateContext.remove")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </div>
  );
}
