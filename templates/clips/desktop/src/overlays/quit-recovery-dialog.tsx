import { useT } from "@agent-native/core/client/i18n";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../components/ui/alert-dialog";
import { Button } from "../components/ui/button";

type PendingAction = "keep-open" | "quit" | null;

export function QuitRecoveryDialog() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<PendingAction>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let mounted = true;
    let unlisten: (() => void) | null = null;
    listen("meetings:quit-recovery-required", () => {
      if (!mounted) return;
      setError(false);
      setPending(null);
      setOpen(true);
    })
      .then((dispose) => {
        if (mounted) unlisten = dispose;
        else dispose();
      })
      .catch((registrationError) => {
        console.warn(
          "[clips-popover] quit recovery listener registration failed:",
          registrationError,
        );
      });
    return () => {
      mounted = false;
      unlisten?.();
    };
  }, []);

  async function keepOpen() {
    if (pending) return;
    setPending("keep-open");
    setError(false);
    try {
      await invoke("quit_teardown_cancel");
      setOpen(false);
    } catch (actionError) {
      console.warn("[clips-popover] could not keep Clips open:", actionError);
      setError(true);
    } finally {
      setPending(null);
    }
  }

  async function quitAnyway() {
    if (pending) return;
    setPending("quit");
    setError(false);
    try {
      await invoke("quit_teardown_force");
    } catch (actionError) {
      console.warn("[clips-popover] could not force quit Clips:", actionError);
      setError(true);
      setPending(null);
    }
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) setOpen(true);
      }}
    >
      <AlertDialogContent
        className="max-w-[calc(100vw-24px)] gap-4 p-5 sm:max-w-sm"
        onEscapeKeyDown={(event) => event.preventDefault()}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{t("quitRecovery.title")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("quitRecovery.body")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {t("quitRecovery.actionFailed")}
          </p>
        ) : null}
        <AlertDialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={keepOpen}
            disabled={pending !== null}
          >
            {t("quitRecovery.keepOpen")}
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={quitAnyway}
            disabled={pending !== null}
          >
            {t("quitRecovery.quitAnyway")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
