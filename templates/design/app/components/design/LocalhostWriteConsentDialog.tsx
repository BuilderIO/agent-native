import {
  actionErrorMessage,
  callAction,
  useActionMutation,
  useActionQuery,
  useSession,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { buildSignInReturnHref } from "@agent-native/core/client/sign-in-return";
import {
  IconCircleCheck,
  IconDeviceFloppy,
  IconFolderOpen,
  IconInfoCircle,
  IconLock,
  IconLogin2,
  IconMessage,
} from "@tabler/icons-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import { useLocation, useNavigate } from "react-router";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { sendToDesignAgentChat } from "@/lib/agent-chat";
import {
  LOCALHOST_CONSENT_RETURN_PARAM,
  localhostConsentRequestDisposition,
  localhostConsentRequestRefetchInterval,
  localhostConsentReturnPath,
} from "@/pages/design-editor/localhost-consent-request";

export interface LocalhostWriteConsentPayload {
  rootPath: string;
  files: string[];
  onGranted: (grant: {
    grantId: string;
    rootPath: string;
    grantedUntil: string;
  }) => void;
  onCancel: () => void;
  onError?: ((error: unknown) => void) | undefined;
}

type ConsentRefusal = "sign-in" | "denied";

// The grant needs the visitor's own browser sign-in, which a Visual Edit link
// or embed credential never supplies: 401 asks for that sign-in, 403 means the
// signed-in account itself lacks editor access.
function refusalForGrantError(error: unknown): ConsentRefusal | null {
  const status = (error as { status?: unknown } | null)?.status;
  if (status === 401) return "sign-in";
  if (status === 403) return "denied";
  return null;
}

interface LocalhostWriteConsentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  designId: string;
  connectionId: string;
  payload: LocalhostWriteConsentPayload | null;
}

export function LocalhostWriteConsentDialog({
  open,
  onOpenChange,
  designId,
  connectionId,
  payload,
}: LocalhostWriteConsentDialogProps) {
  const t = useT();
  const { status: sessionStatus } = useSession();
  const [grantingFor, setGrantingFor] =
    useState<LocalhostWriteConsentPayload | null>(null);
  const [preparingFor, setPreparingFor] =
    useState<LocalhostWriteConsentPayload | null>(null);
  const [refusal, setRefusal] = useState<{
    payload: LocalhostWriteConsentPayload;
    kind: ConsentRefusal;
  } | null>(null);
  const granting = grantingFor !== null && grantingFor === payload;
  const preparingSignIn = preparingFor !== null && preparingFor === payload;
  const awaitingAnswer = granting || preparingSignIn;
  const sessionPending =
    sessionStatus === "loading" || sessionStatus === "signing-out";
  const blocked =
    (refusal?.payload === payload ? refusal.kind : null) ??
    (sessionStatus === "unauthenticated" ? "sign-in" : null);

  // A grant or sign-in save belongs to the request, design, and connection it
  // started from; once any of them changes or the dialog unmounts, its late
  // result must not run the edit, report, close a newer request, or navigate.
  const liveRequestRef = useRef<object | null>(null);
  useEffect(() => {
    liveRequestRef.current = {};
    return () => {
      liveRequestRef.current = null;
    };
  }, [payload, designId, connectionId]);

  async function handleAllowWrites() {
    if (!payload || !designId || !connectionId || sessionPending || blocked) {
      return;
    }
    const requested = payload;
    const live = liveRequestRef.current;
    setGrantingFor(requested);
    try {
      const result = await callAction<{
        grantId: string;
        rootPath: string;
        grantedUntil: string;
      }>("grant-localhost-write-consent", {
        designId,
        connectionId,
      });
      if (liveRequestRef.current !== live) return;
      requested.onGranted(result);
      onOpenChange(false);
    } catch (error) {
      if (liveRequestRef.current !== live) return;
      const kind = refusalForGrantError(error);
      if (kind) {
        setRefusal({ payload: requested, kind });
        return;
      }
      // The request stays open and pending so Allow writes can be retried.
      if (requested.onError) requested.onError(error);
      else toast.error(actionErrorMessage(error) ?? t("common.genericError"));
    } finally {
      setGrantingFor((current) => (current === requested ? null : current));
    }
  }

  // Sign-in reloads the page, so this mount's callback cannot survive it.
  // Only the request metadata goes to the server and only its ID rides the
  // return URL; the reopened dialog grants for whoever signed in.
  async function handleSignIn(event: MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    if (!payload || !designId || !connectionId || preparingSignIn) return;
    const requested = payload;
    const live = liveRequestRef.current;
    const returnPath = window.location.pathname;
    setPreparingFor(requested);
    try {
      const queued = await callAction<{ requestId?: string } | null>(
        "request-localhost-write-consent",
        {
          designId,
          connectionId,
          files: requested.files,
          resumeAfterSignIn: true,
        },
      );
      if (liveRequestRef.current !== live) return;
      if (!queued?.requestId) {
        toast.error(t("designEditor.localhostConsent.prepareSignInError"));
        return;
      }
      window.location.assign(
        buildSignInReturnHref({
          returnTo: localhostConsentReturnPath(returnPath, queued.requestId),
        }),
      );
    } catch (error) {
      if (liveRequestRef.current !== live) return;
      toast.error(actionErrorMessage(error) ?? t("common.genericError"));
    } finally {
      setPreparingFor((current) => (current === requested ? null : current));
    }
  }

  // Cancel, Escape, and the backdrop all wait for a grant or sign-in save in
  // flight: cancelling under it would end a request whose answer is still
  // coming, and a copy saved for sign-in would stay pending and reopen.
  function handleCancel() {
    if (awaitingAnswer) return;
    payload?.onCancel();
    onOpenChange(false);
  }

  if (!payload) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) onOpenChange(next);
        else handleCancel();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <IconDeviceFloppy className="size-4" />
            {"Allow file writes" /* i18n-ignore */}
          </DialogTitle>
          <DialogDescription>
            {
              "The agent wants to write source files on your machine. This access is scoped to the folder below and expires automatically after 8 hours." /* i18n-ignore */
            }
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1 text-sm">
          <div className="rounded-lg border bg-muted/50 px-3 py-2">
            <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground mb-1">
              <IconFolderOpen className="size-3.5 shrink-0" />
              {"Root folder" /* i18n-ignore */}
            </div>
            <code className="break-all text-xs text-foreground">
              {payload.rootPath}
            </code>
          </div>

          {payload.files.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">
                {"Files to be written:" /* i18n-ignore */}
              </p>
              <ul className="space-y-0.5 pl-1">
                {payload.files.map((file) => (
                  <li key={file} className="flex items-center gap-1.5 text-xs">
                    <span className="size-1 rounded-full bg-muted-foreground/50 shrink-0" />
                    <code className="break-all">{file}</code>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            {
              "Only text and code files can be written — never secrets like .env or key files. Paths outside the root folder are always blocked." /* i18n-ignore */
            }
          </p>

          {blocked ? (
            <div
              role="alert"
              className="flex items-center gap-2 rounded-lg border px-3 py-2 text-xs text-foreground"
            >
              <IconLock className="size-3.5 shrink-0 text-muted-foreground" />
              {
                blocked === "sign-in"
                  ? t("agentChat.accessGate.signedOutDescription") // i18n-key-ignore shared framework catalog
                  : t("agentChat.accessGate.deniedTitle") // i18n-key-ignore shared framework catalog
              }
            </div>
          ) : null}
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={handleCancel}
            disabled={awaitingAnswer}
          >
            {"Cancel" /* i18n-ignore */}
          </Button>
          {blocked === "sign-in" ? (
            <Button asChild>
              <a
                href={
                  typeof window === "undefined"
                    ? buildSignInReturnHref()
                    : buildSignInReturnHref({
                        returnTo: window.location.pathname,
                      })
                }
                aria-disabled={preparingSignIn || undefined}
                onClick={(event) => void handleSignIn(event)}
              >
                {preparingSignIn ? (
                  <Spinner className="size-4" />
                ) : (
                  <IconLogin2 className="size-4" />
                )}
                {
                  t("agentChat.accessGate.signIn") // i18n-key-ignore shared framework catalog
                }
              </a>
            </Button>
          ) : blocked === "denied" ? null : (
            <Button
              onClick={() => void handleAllowWrites()}
              disabled={granting || sessionPending}
            >
              {
                granting ? (
                  <>
                    <Spinner className="mr-2 size-3.5" />
                    {"Granting…" /* i18n-ignore */}
                  </>
                ) : (
                  "Allow writes"
                ) /* i18n-ignore */
              }
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export type LocalhostWriteConsentNotice =
  | { kind: "approved"; rootPath: string }
  | { kind: "unavailable" };

export interface LocalhostWriteConsentLocalRequest {
  connectionId: string;
  rootPath: string;
  files: string[];
  onGranted: LocalhostWriteConsentPayload["onGranted"];
  onCancel?: (() => void) | undefined;
  onError?: LocalhostWriteConsentPayload["onError"];
}

interface PendingConsentRequest {
  designId: string;
  connectionId: string;
  rootPath: string;
  files: string[];
  requestedAt: string;
  requestId?: string | undefined;
}

function consentRequestKey(designId: string, request: PendingConsentRequest) {
  return `${designId}:${request.requestedAt}:${request.requestId ?? ""}`;
}

/**
 * Editor-wide owner of the write-consent dialog. Agent requests (and requests
 * saved for sign-in) live on the server until the user grants or cancels, so
 * a fresh mount after sign-in reopens the same request. A request that comes
 * back from the server has no edit callback: approving it asks the user to run
 * the edit again instead of replaying anything.
 */
export function useLocalhostWriteConsent({
  designId,
  canEditDesign,
}: {
  designId: string | undefined;
  canEditDesign: boolean;
}) {
  const t = useT();
  const location = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [payload, setPayload] = useState<LocalhostWriteConsentPayload | null>(
    null,
  );
  const [connectionId, setConnectionId] = useState("");
  const [notice, setNotice] = useState<LocalhostWriteConsentNotice | null>(
    null,
  );
  const [failedClearKey, setFailedClearKey] = useState<string | null>(null);
  const lastHandledKeyRef = useRef<string | null>(null);
  const resolvedReturnRequestIdRef = useRef<string | null>(null);
  const returnRequestId = new URLSearchParams(location.search).get(
    LOCALHOST_CONSENT_RETURN_PARAM,
  );

  // Agent requests run in a design-scoped capability session, separate from
  // the browser's app-state session, so retrieve the handoff through an editor
  // action instead of reading it from client app state.
  const requestQuery = useActionQuery(
    "get-localhost-write-consent-request",
    { designId: designId ?? "" },
    {
      enabled: Boolean(designId && canEditDesign),
      refetchInterval: (query) => {
        const request = query.state.data?.request;
        return localhostConsentRequestRefetchInterval({
          requestKey:
            request && designId ? consentRequestKey(designId, request) : null,
          failedClearKey,
          queryFailed: query.state.status === "error",
        });
      },
      notifyOnChangeProps: [
        "data",
        "error",
        "status",
        ...(failedClearKey ? (["dataUpdatedAt"] as const) : []),
        ...(returnRequestId ? (["isFetchedAfterMount"] as const) : []),
      ],
    },
  );
  const clearRequestAsync = useActionMutation(
    "clear-localhost-write-consent-request",
  ).mutateAsync;
  const refetchRequest = requestQuery.refetch;

  const clearRequest = useCallback(
    (request: PendingConsentRequest, quiet: boolean) => {
      if (!designId) return;
      const requestKey = consentRequestKey(designId, request);
      void clearRequestAsync({
        designId,
        requestedAt: request.requestedAt,
        ...(request.requestId ? { requestId: request.requestId } : {}),
      })
        .then(async () => {
          setFailedClearKey(null);
          await refetchRequest();
        })
        .catch((error) => {
          setFailedClearKey(requestKey);
          if (!quiet) {
            toast.error(actionErrorMessage(error) ?? t("common.genericError"));
          }
        });
    },
    [clearRequestAsync, designId, refetchRequest, t],
  );

  const request = requestQuery.data?.request ?? null;
  const requestLoaded =
    requestQuery.status === "success" && requestQuery.isFetchedAfterMount;

  useEffect(() => {
    if (!designId || !canEditDesign || !requestLoaded) return;
    if (
      returnRequestId &&
      resolvedReturnRequestIdRef.current !== returnRequestId
    ) {
      resolvedReturnRequestIdRef.current = returnRequestId;
      const search = new URLSearchParams(location.search);
      search.delete(LOCALHOST_CONSENT_RETURN_PARAM);
      const nextSearch = search.toString();
      void navigate(
        {
          pathname: location.pathname,
          search: nextSearch ? `?${nextSearch}` : "",
          hash: location.hash,
        },
        { replace: true },
      );
      if (
        !request ||
        request.designId !== designId ||
        !request.connectionId ||
        request.requestId !== returnRequestId
      ) {
        setNotice({ kind: "unavailable" });
        return;
      }
    }
    if (!request || request.designId !== designId || !request.connectionId) {
      return;
    }
    const requestKey = consentRequestKey(designId, request);
    const disposition = localhostConsentRequestDisposition({
      requestKey,
      lastHandledKey: lastHandledKeyRef.current,
      failedClearKey,
    });
    if (disposition === "ignore") return;
    if (disposition === "retry-clear") {
      clearRequest(request, true);
      return;
    }
    // Wait for the dialog or notice on screen; this request stays pending.
    if (payload || notice) return;
    lastHandledKeyRef.current = requestKey;
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      clearRequest(request, false);
    };
    setConnectionId(request.connectionId);
    setPayload({
      rootPath: request.rootPath,
      files: request.files,
      onGranted: () => {
        settle();
        setNotice({ kind: "approved", rootPath: request.rootPath });
      },
      onCancel: settle,
      onError: (error) => {
        toast.error(actionErrorMessage(error) ?? t("common.genericError"));
      },
    });
    setOpen(true);
  }, [
    canEditDesign,
    clearRequest,
    designId,
    failedClearKey,
    location.hash,
    location.pathname,
    location.search,
    navigate,
    notice,
    payload,
    request,
    requestLoaded,
    requestQuery.dataUpdatedAt,
    returnRequestId,
    t,
  ]);

  const openLocalConsent = useCallback(
    (local: LocalhostWriteConsentLocalRequest) => {
      setConnectionId(local.connectionId);
      setPayload({
        rootPath: local.rootPath,
        files: local.files,
        onGranted: local.onGranted,
        onCancel: local.onCancel ?? (() => {}),
        onError: local.onError,
      });
      setOpen(true);
    },
    [],
  );

  // Closing is not cancelling: a granted request closes through here too, so
  // only the dialog's own Cancel calls onCancel.
  const onOpenChange = useCallback((next: boolean) => {
    if (!next) setPayload(null);
    setOpen(next);
  }, []);

  const closeNotice = useCallback(() => setNotice(null), []);

  return {
    open,
    payload,
    connectionId,
    notice,
    openLocalConsent,
    onOpenChange,
    closeNotice,
  };
}

export type LocalhostWriteConsentState = ReturnType<
  typeof useLocalhostWriteConsent
>;

function LocalhostWriteConsentNoticeDialog({
  notice,
  onClose,
}: {
  notice: LocalhostWriteConsentNotice | null;
  onClose: () => void;
}) {
  const t = useT();
  if (!notice) return null;
  const approved = notice.kind === "approved";
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {approved ? (
              <IconCircleCheck className="size-4" />
            ) : (
              <IconInfoCircle className="size-4" />
            )}
            {approved
              ? t("designEditor.localhostConsent.approvedTitle")
              : t("designEditor.localhostConsent.unavailableTitle")}
          </DialogTitle>
          <DialogDescription>
            {approved
              ? t("designEditor.localhostConsent.approvedDescription")
              : t("designEditor.localhostConsent.unavailableDescription")}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button variant={approved ? "outline" : "default"} onClick={onClose}>
            {t("designEditor.localhostConsent.close")}
          </Button>
          {notice.kind === "approved" ? (
            <Button
              onClick={() => {
                sendToDesignAgentChat({
                  message: t("designEditor.localhostConsent.retryPrompt", {
                    rootPath: notice.rootPath,
                  }),
                  submit: false,
                  openSidebar: true,
                });
                onClose();
              }}
            >
              <IconMessage className="size-4" />
              {t("designEditor.localhostConsent.retryInChat")}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function LocalhostWriteConsentSurface({
  designId,
  consent,
}: {
  designId: string;
  consent: LocalhostWriteConsentState;
}) {
  return (
    <>
      {consent.connectionId ? (
        <LocalhostWriteConsentDialog
          open={consent.open}
          onOpenChange={consent.onOpenChange}
          designId={designId}
          connectionId={consent.connectionId}
          payload={consent.payload}
        />
      ) : null}
      <LocalhostWriteConsentNoticeDialog
        notice={consent.notice}
        onClose={consent.closeNotice}
      />
    </>
  );
}
