import { callAction, useSession } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { buildSignInReturnHref } from "@agent-native/core/client/sign-in-return";
import {
  IconDeviceFloppy,
  IconFolderOpen,
  IconLock,
  IconLogin2,
} from "@tabler/icons-react";
import { useState } from "react";

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

export interface LocalhostWriteConsentPayload {
  rootPath: string;
  files: string[];
  onGranted: (grant: {
    grantId: string;
    rootPath: string;
    grantedUntil: string;
  }) => void;
  onCancel: () => void;
  onError?: (error: unknown) => void;
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
  const [granting, setGranting] = useState(false);
  const [refusal, setRefusal] = useState<{
    payload: LocalhostWriteConsentPayload;
    kind: ConsentRefusal;
  } | null>(null);
  const sessionPending =
    sessionStatus === "loading" || sessionStatus === "signing-out";
  const blocked =
    (refusal?.payload === payload ? refusal.kind : null) ??
    (sessionStatus === "unauthenticated" ? "sign-in" : null);

  async function handleAllowWrites() {
    if (!payload || !designId || !connectionId || sessionPending || blocked) {
      return;
    }
    const requested = payload;
    setGranting(true);
    try {
      const result = await callAction<{
        grantId: string;
        rootPath: string;
        grantedUntil: string;
      }>("grant-localhost-write-consent", {
        designId,
        connectionId,
      });
      onOpenChange(false);
      requested.onGranted(result);
    } catch (error) {
      const kind = refusalForGrantError(error);
      if (kind) {
        setRefusal({ payload: requested, kind });
        return;
      }
      requested.onError?.(error);
      onOpenChange(false);
      requested.onCancel();
    } finally {
      setGranting(false);
    }
  }

  function handleCancel() {
    payload?.onCancel();
    onOpenChange(false);
  }

  if (!payload) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) handleCancel();
        else onOpenChange(next);
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
          <Button variant="outline" onClick={handleCancel} disabled={granting}>
            {"Cancel" /* i18n-ignore */}
          </Button>
          {blocked === "sign-in" ? (
            <Button asChild>
              <a href={buildSignInReturnHref()}>
                <IconLogin2 className="size-4" />
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
