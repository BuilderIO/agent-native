import { Button } from "@agent-native/toolkit/ui/button";
import { IconCheck, IconCode, IconCopy } from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  formatAgentNativeDiagnostics,
  getAgentNativeDiagnostics,
  getAgentNativePackageVersions,
} from "./agent-native-version.js";
import { Dialog, DialogContent, DialogTitle } from "./components/ui/dialog.js";
import { useT } from "./i18n.js";

export interface AboutAgentNativeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AboutAgentNativeDialog({
  open,
  onOpenChange,
}: AboutAgentNativeDialogProps) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const copyResetTimer = useRef<number | null>(null);
  const packageVersions = getAgentNativePackageVersions();
  const diagnostics = useMemo(() => formatAgentNativeDiagnostics(), []);
  const { buildId, environment } = getAgentNativeDiagnostics();

  useEffect(() => {
    if (!open) {
      setCopied(false);
    }
  }, [open]);

  useEffect(
    () => () => {
      if (copyResetTimer.current !== null) {
        window.clearTimeout(copyResetTimer.current);
      }
    },
    [],
  );

  const handleCopy = async () => {
    if (!navigator.clipboard?.writeText) {
      return;
    }

    try {
      await navigator.clipboard.writeText(diagnostics);
      setCopied(true);
      if (copyResetTimer.current !== null) {
        window.clearTimeout(copyResetTimer.current);
      }
      copyResetTimer.current = window.setTimeout(() => {
        setCopied(false);
        copyResetTimer.current = null;
      }, 1600);
    } catch {
      // Clipboard access is optional; the dialog remains useful without it.
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined} className="max-w-md gap-5">
        <DialogTitle className="flex items-center gap-2 text-base">
          <IconCode className="size-4 text-muted-foreground" />
          {t("agentChat.aboutAgentNative.title", {
            defaultValue: "About Agent Native",
          })}
        </DialogTitle>

        <div className="overflow-hidden rounded-md border border-border">
          {packageVersions.length > 0 ? (
            packageVersions.map(({ name, version }) => (
              <div
                className="flex items-center justify-between gap-4 border-b border-border px-3 py-2 last:border-b-0"
                key={name}
              >
                <span className="min-w-0 truncate font-mono text-xs text-foreground">
                  {name}
                </span>
                <span className="shrink-0 font-mono text-xs text-muted-foreground">
                  <span className="sr-only">
                    {t("agentChat.aboutAgentNative.version", {
                      defaultValue: "Version",
                    })}
                  </span>
                  {version}
                </span>
              </div>
            ))
          ) : (
            <div className="px-3 py-2 font-mono text-xs text-muted-foreground">
              @agent-native/core - unknown
            </div>
          )}
        </div>

        <dl className="grid gap-2 text-xs">
          <div className="flex items-center justify-between gap-4">
            <dt className="text-muted-foreground">
              {t("agentChat.aboutAgentNative.environment", {
                defaultValue: "Environment",
              })}
            </dt>
            <dd className="font-mono text-foreground">{environment}</dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt className="text-muted-foreground">
              {t("agentChat.aboutAgentNative.build", {
                defaultValue: "Build",
              })}
            </dt>
            <dd className="max-w-[16rem] truncate font-mono text-foreground">
              {buildId}
            </dd>
          </div>
        </dl>

        <Button
          className="w-full"
          onClick={() => void handleCopy()}
          type="button"
          variant="outline"
        >
          {copied ? <IconCheck /> : <IconCopy />}
          {copied
            ? t("agentChat.common.copied", { defaultValue: "Copied" })
            : t("agentChat.aboutAgentNative.copyDiagnostics", {
                defaultValue: "Copy diagnostics",
              })}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
