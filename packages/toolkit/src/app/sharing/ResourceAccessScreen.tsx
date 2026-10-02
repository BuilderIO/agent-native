import { useT } from "@agent-native/core/client/i18n";
import { buildSignInReturnHref } from "@agent-native/core/client/sign-in-return";
import {
  ActionButton,
  Dialog,
  TextArea,
} from "@agent-native/toolkit/design-system";
import { cn } from "@agent-native/toolkit/utils";
import {
  IconFileUnknown,
  IconLock,
  IconLogin2,
  IconTrash,
} from "@tabler/icons-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

export type ResourceAccessScreenState =
  | "denied"
  | "missing"
  | "trashed"
  | "signed-out";

/** Asking the owner for access, on the `denied` state. */
export interface ResourceAccessScreenRequest {
  /** The viewer already asked, and their request is open. */
  sent: boolean;
  /** Sends the request with an optional note; rejects when it fails. */
  onRequest: (note: string) => Promise<void>;
  /** A request is being sent. */
  sending?: boolean;
  /** Why the last request failed. */
  error?: { errorCode: string | null } | null;
}

export interface ResourceAccessScreenProps {
  state: ResourceAccessScreenState;
  /** The app's heading for this state, such as "This page doesn't exist". */
  title?: ReactNode;
  description?: ReactNode;
  /** The account the viewer is signed in as, shown as text. */
  signedInEmail?: string | null;
  /** The app's own actions, such as a link back to the viewer's work. */
  actions?: ReactNode;
  /** Shows Switch account after the app's actions. */
  onSwitchAccount?: () => void;
  /**
   * Replaces the signed-out state's Sign in, which by default goes to sign-in
   * and comes back to this link.
   */
  onSignIn?: () => void;
  /** Offers Request access on the `denied` state. */
  request?: ResourceAccessScreenRequest;
  /**
   * The app takes access requests for this kind of resource, so the
   * signed-out state says signing in is how to ask. It says nothing about
   * this particular link.
   */
  acceptsRequests?: boolean;
  /** Rendered above the screen, such as a sidebar toggle. */
  header?: ReactNode;
  /** Render as the page's `main` landmark when the app shell has none. */
  landmark?: boolean;
  className?: string;
}

const STATE_ICONS = {
  denied: IconLock,
  missing: IconFileUnknown,
  trashed: IconTrash,
  "signed-out": IconLogin2,
} satisfies Record<ResourceAccessScreenState, unknown>;

/**
 * What a link to a resource the viewer can't open says, in place of the
 * resource. It stays on the link's URL, never redirects, and states the
 * situation as static content, so focus starts on the heading rather than a
 * toast or live region.
 */
export function ResourceAccessScreen({
  state,
  title,
  description,
  signedInEmail,
  actions,
  onSwitchAccount,
  onSignIn,
  request,
  acceptsRequests = false,
  header,
  landmark = false,
  className,
}: ResourceAccessScreenProps) {
  const t = useT();
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [requestOpen, setRequestOpen] = useState(false);
  const Icon = STATE_ICONS[state];
  const Root = landmark ? "main" : "div";
  const signIn =
    state === "signed-out"
      ? (onSignIn ?? (() => window.location.assign(buildSignInReturnHref())))
      : undefined;
  const offersRequest = state === "denied" && request !== undefined;

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, [state]);

  const defaults = {
    denied: {
      title: t("agentChat.accessGate.deniedTitle", {
        defaultValue: "You don't have access",
      }),
      description: request
        ? request.sent
          ? t("agentChat.accessGate.requestSent", {
              defaultValue: "Request sent. The owner has been notified.",
            })
          : t("agentChat.accessGate.requestDescription", {
              defaultValue: "Request access and the owner will be notified.",
            })
        : t("agentChat.accessGate.deniedDescription", {
            defaultValue: "Ask the owner to share it with you.",
          }),
    },
    missing: {
      title: t("agentChat.accessGate.missingTitle", {
        defaultValue: "This doesn't exist",
      }),
      description: t("agentChat.accessGate.missingDescription", {
        defaultValue: "The link may be wrong, or it may have been deleted.",
      }),
    },
    trashed: {
      title: t("agentChat.accessGate.trashedTitle", {
        defaultValue: "This is in the trash",
      }),
      description: t("agentChat.accessGate.trashedDescription", {
        defaultValue: "Restore it to open it again.",
      }),
    },
    "signed-out": {
      title: t("agentChat.accessGate.signedOutTitle", {
        defaultValue: "Sign in to continue",
      }),
      description: acceptsRequests
        ? t("agentChat.accessGate.signedOutRequestDescription", {
            defaultValue: "Sign in to request access.",
          })
        : t("agentChat.accessGate.signedOutDescription", {
            defaultValue: "Sign in with an account that has access.",
          }),
    },
  }[state];

  return (
    <Root
      className={cn("flex min-h-0 flex-1 flex-col", className)}
      data-access-state={state}
    >
      {header}
      <div className="flex min-h-0 flex-1 items-center justify-center bg-background px-6 py-10">
        <section
          aria-labelledby={headingId}
          className="flex w-full max-w-sm flex-col items-center text-center"
        >
          <div
            aria-hidden="true"
            className="mb-5 flex size-12 items-center justify-center rounded-xl border border-border bg-muted text-muted-foreground"
          >
            <Icon size={22} />
          </div>
          <h1
            ref={headingRef}
            id={headingId}
            tabIndex={-1}
            className="text-2xl font-semibold tracking-normal text-foreground outline-none"
          >
            {title ?? defaults.title}
          </h1>
          {/* A request's outcome is announced politely when it changes; the
              state on arrival is read from the focused heading instead. */}
          <p
            role={offersRequest ? "status" : undefined}
            className="mt-3 text-sm leading-6 text-muted-foreground"
          >
            {description ?? defaults.description}
          </p>
          {signedInEmail ? (
            <p className="mt-4 break-all text-sm text-muted-foreground">
              {t("agentChat.accessGate.signedInAs", {
                email: signedInEmail,
                defaultValue: "You're signed in as {{email}}",
              })}
            </p>
          ) : null}
          {signIn || actions || onSwitchAccount || offersRequest ? (
            <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
              {signIn ? (
                <ActionButton onPress={signIn}>
                  {t("agentChat.accessGate.signIn", {
                    defaultValue: "Sign in",
                  })}
                </ActionButton>
              ) : null}
              {offersRequest && !request.sent ? (
                <ActionButton onPress={() => setRequestOpen(true)}>
                  {t("agentChat.accessGate.requestAccess", {
                    defaultValue: "Request access",
                  })}
                </ActionButton>
              ) : null}
              {actions}
              {onSwitchAccount ? (
                <ActionButton emphasis="outline" onPress={onSwitchAccount}>
                  {t("agentChat.accessGate.switchAccount", {
                    defaultValue: "Switch account",
                  })}
                </ActionButton>
              ) : null}
            </div>
          ) : null}
        </section>
      </div>
      {offersRequest ? (
        <RequestAccessDialog
          open={requestOpen}
          onOpenChange={setRequestOpen}
          request={request}
        />
      ) : null}
    </Root>
  );
}

function RequestAccessDialog({
  open,
  onOpenChange,
  request,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  request: ResourceAccessScreenRequest;
}) {
  const t = useT();
  const [note, setNote] = useState("");
  const [failed, setFailed] = useState(false);
  const errorCode = failed ? (request.error?.errorCode ?? null) : null;

  const send = async () => {
    setFailed(false);
    try {
      await request.onRequest(note);
      setNote("");
      onOpenChange(false);
    } catch {
      setFailed(true);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setFailed(false);
        onOpenChange(next);
      }}
      title={t("agentChat.accessGate.requestAccess", {
        defaultValue: "Request access",
      })}
      closeLabel={t("agentChat.accessGate.cancel", { defaultValue: "Cancel" })}
      size="small"
      footer={
        <div className="flex justify-end gap-2">
          <ActionButton emphasis="outline" onPress={() => onOpenChange(false)}>
            {t("agentChat.accessGate.cancel", { defaultValue: "Cancel" })}
          </ActionButton>
          <ActionButton
            pending={request.sending}
            disabled={request.sending}
            onPress={() => void send()}
          >
            {t("agentChat.accessGate.sendRequest", {
              defaultValue: "Send request",
            })}
          </ActionButton>
        </div>
      }
    >
      <TextArea
        label={t("agentChat.accessGate.requestNoteLabel", {
          defaultValue: "Note (optional)",
        })}
        placeholder={t("agentChat.accessGate.requestNotePlaceholder", {
          defaultValue: "Add a note for the owner",
        })}
        value={note}
        onChange={setNote}
        maxLength={500}
        rows={3}
        autoFocus
        errorMessage={
          failed
            ? errorCode === "access_request_rate_limited"
              ? t("agentChat.accessGate.requestRateLimited", {
                  defaultValue: "Too many requests right now. Try again later.",
                })
              : t("agentChat.accessGate.requestFailed", {
                  defaultValue: "Couldn't send your request. Try again.",
                })
            : undefined
        }
        invalid={failed}
      />
    </Dialog>
  );
}
