import { callAction } from "@agent-native/core/client";
import { IconDeviceFloppy, IconFolderOpen } from "@tabler/icons-react";
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
  /** The path being granted write access. */
  rootPath: string;
  /** File(s) about to be written (for display only). */
  files: string[];
  /** Pending callback to invoke after user grants consent. */
  onGranted: (grant: {
    grantId: string;
    rootPath: string;
    grantedUntil: string;
  }) => void;
  /** Called when the user cancels. */
  onCancel: () => void;
}

interface LocalhostWriteConsentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  designId: string;
  connectionId: string;
  payload: LocalhostWriteConsentPayload | null;
}

/**
 * Modal dialog requesting explicit user consent before the agent writes local
 * files. Shows the rootPath that will be granted write access and the specific
 * file(s) about to be modified. The grant expires after 8 hours and is scoped
 * to that folder only.
 */
export function LocalhostWriteConsentDialog({
  open,
  onOpenChange,
  designId,
  connectionId,
  payload,
}: LocalhostWriteConsentDialogProps) {
  const [granting, setGranting] = useState(false);

  async function handleAllowWrites() {
    if (!payload || !designId || !connectionId) return;
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
      payload.onGranted(result);
    } catch {
      // Silently close; the caller's onCancel path already guards the write.
      onOpenChange(false);
      payload.onCancel();
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
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={handleCancel} disabled={granting}>
            {"Cancel" /* i18n-ignore */}
          </Button>
          <Button onClick={() => void handleAllowWrites()} disabled={granting}>
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
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
