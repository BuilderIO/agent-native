import { writeClipboardText } from "@agent-native/core/client/clipboard";
import { useT } from "@agent-native/core/client/i18n";
import { IconCircleCheck, IconCopy } from "@tabler/icons-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

const VISUAL_EDIT_SKILL_INSTALL_COMMAND =
  "npx @agent-native/core@latest skills add visual-edit";

export default function VisualEditPage() {
  const t = useT();
  const [installCommandCopied, setInstallCommandCopied] = useState(false);
  const copyResetTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copyResetTimeoutRef.current) {
        window.clearTimeout(copyResetTimeoutRef.current);
      }
    };
  }, []);

  const copyInstallCommand = useCallback(async () => {
    try {
      if (!(await writeClipboardText(VISUAL_EDIT_SKILL_INSTALL_COMMAND))) {
        toast.error(t("common.genericError"));
        return;
      }

      setInstallCommandCopied(true);
      toast.success(t("designEditor.copied"));
      if (copyResetTimeoutRef.current) {
        window.clearTimeout(copyResetTimeoutRef.current);
      }
      copyResetTimeoutRef.current = window.setTimeout(() => {
        setInstallCommandCopied(false);
      }, 2200);
    } catch {
      toast.error(t("common.genericError"));
    }
  }, [t]);

  return (
    <main className="min-h-[100dvh] bg-background text-foreground">
      <section className="mx-auto flex min-h-[100dvh] w-full max-w-2xl items-center px-5 py-16 sm:px-8">
        <div className="w-full">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            {t("visualEdit.title")}
          </h1>
          <p className="mt-3 max-w-lg text-sm leading-6 text-muted-foreground">
            {t("visualEdit.description")}
          </p>
          <div className="mt-6 flex w-full items-center gap-2 rounded-lg border border-border bg-muted/40 p-1.5">
            <code className="min-w-0 flex-1 overflow-x-auto px-2 py-1 font-mono text-xs leading-5 text-foreground">
              {VISUAL_EDIT_SKILL_INSTALL_COMMAND}
            </code>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={copyInstallCommand}
              className="min-w-20 shrink-0 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
              aria-label={
                installCommandCopied
                  ? t("designEditor.copied")
                  : t("layersPanel.copy")
              }
            >
              {installCommandCopied ? (
                <IconCircleCheck className="size-3.5 text-emerald-600" />
              ) : (
                <IconCopy className="size-3.5" />
              )}
              {installCommandCopied
                ? t("designEditor.copied")
                : t("layersPanel.copy")}
            </Button>
          </div>
        </div>
      </section>
    </main>
  );
}
