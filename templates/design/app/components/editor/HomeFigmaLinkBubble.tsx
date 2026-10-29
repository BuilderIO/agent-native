import {
  actionErrorMessage,
  useActionMutation,
} from "@agent-native/core/client/hooks";
import { useFormatters, useT } from "@agent-native/core/client/i18n";
import { openAgentSettings } from "@agent-native/toolkit/app/shared";
import { IconBrandFigma, IconLoader2 } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  importResultNotification,
  type ImportResult,
} from "@/lib/design-import";
import { FIGMA_ACCESS_TOKEN_SECRET_KEY } from "@/lib/figma-connection";
import type { FigmaLink } from "@/lib/figma-url";

import { getFigmaFileTitle } from "./FigmaLinkComposerBubble";

export function HomeFigmaLinkBubble({ link }: { link: FigmaLink }) {
  const t = useT();
  const formatters = useFormatters();
  const navigate = useNavigate();
  const importFrame = useActionMutation("import-figma-frame");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const pending = useRef(false);
  const fileTitle =
    getFigmaFileTitle(link) ??
    t(
      link.kind === "frame"
        ? "chat.figmaLink.frameDetected"
        : "chat.figmaLink.fileDetected",
    );

  useEffect(() => {
    setError(undefined);
  }, [link.url]);

  const handleImport = async () => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(undefined);
    try {
      const result: ImportResult = await importFrame.mutateAsync({
        figmaUrl: link.url,
        createNew: true,
      });
      if (!result.designId || !result.files?.length)
        throw new Error(t("designEditor.import.errors.figmaImportFailed"));
      const fidelityWarnings: string[] = [];
      const imageFallbackCount = result.fidelityReport?.imageFallbacks.length;
      if (imageFallbackCount) {
        fidelityWarnings.push(
          t("designEditor.import.figmaImageFallbackWarning", {
            count: formatters.formatNumber(imageFallbackCount),
          }),
        );
      }
      const approximatedCount = result.fidelityReport?.approximated.length;
      if (approximatedCount) {
        fidelityWarnings.push(
          t("designEditor.import.figmaApproximationWarning", {
            count: formatters.formatNumber(approximatedCount),
          }),
        );
      }
      const notification = importResultNotification(
        result,
        t("designEditor.import.figmaUrlSuccess"),
        { fidelityWarnings },
      );
      toast[notification.variant](notification.title, {
        description: notification.description,
      });
      void navigate(`/design/${result.designId}`);
    } catch (cause) {
      setError(
        actionErrorMessage(cause) ??
          t("designEditor.import.errors.importFailed"),
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };

  return (
    <div
      data-design-home-figma-link
      className="grid gap-2 rounded-lg border border-border bg-muted/35 px-2.5 py-2"
    >
      <div className="flex min-w-0 items-center gap-2">
        <IconBrandFigma className="size-4 shrink-0 text-foreground" />
        <p
          className="min-w-0 flex-1 truncate text-xs font-medium text-foreground"
          title={fileTitle}
        >
          {fileTitle}
        </p>
        <Button
          type="button"
          size="xs"
          disabled={busy}
          aria-busy={busy}
          onClick={() => void handleImport()}
        >
          {busy ? <IconLoader2 className="motion-safe:animate-spin" /> : null}
          {t("home.import")}
        </Button>
      </div>
      {error ? (
        <div className="flex flex-wrap items-center gap-2">
          <p role="alert" className="min-w-0 flex-1 text-xs text-destructive">
            {error}
          </p>
          <Button
            type="button"
            size="xs"
            variant="outline"
            onClick={() =>
              openAgentSettings(`secrets:${FIGMA_ACCESS_TOKEN_SECRET_KEY}`)
            }
          >
            {t("settings.openAgentSettings")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
