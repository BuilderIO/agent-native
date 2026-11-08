import { useT } from "@agent-native/core/client/i18n";
import { extractGoogleSlidesUrls } from "@shared/google-docs";
import { IconLoader2, IconPresentation } from "@tabler/icons-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";

import { GoogleDriveConnectionCta } from "./GoogleDriveConnectionCta";
import type { usePromptImport } from "./use-prompt-import";

export function useDetectedGoogleSlidesComposerLink(): {
  url: string | null;
  onComposerTextChange: (text: string) => void;
} {
  const urlRef = useRef<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const onComposerTextChange = useCallback((text: string) => {
    const next = extractGoogleSlidesUrls(text).at(0) ?? null;
    if (next === urlRef.current) return;
    urlRef.current = next;
    setUrl(next);
  }, []);
  return { url, onComposerTextChange };
}

export interface GoogleSlidesLinkComposerBubbleProps {
  url: string;
  controller: ReturnType<typeof usePromptImport>;
}

export function GoogleSlidesLinkComposerBubble({
  url,
  controller,
}: GoogleSlidesLinkComposerBubbleProps) {
  const t = useT();
  const [failed, setFailed] = useState(false);
  const busy = controller.importingSource !== null;
  const importing = controller.importingSource === "google-slides";

  useEffect(() => {
    setFailed(false);
  }, [url]);

  const handleImport = () => {
    if (busy) return;
    setFailed(false);
    void controller
      .runImport({ kind: "google-slides", url })
      .then((done) => setFailed(!done));
  };

  return (
    <div
      data-slides-google-slides-link
      className="grid gap-2 rounded-lg border border-border bg-muted/35 px-2.5 py-2"
    >
      <div className="flex min-w-0 items-center gap-2">
        <IconPresentation className="size-4 shrink-0 text-foreground" />
        <p
          className="min-w-0 flex-1 truncate text-xs font-medium text-foreground"
          title={url}
        >
          {t("home.googleSlidesReferenceTitle")}
        </p>
        <Button
          type="button"
          size="xs"
          disabled={busy}
          aria-busy={importing}
          onClick={handleImport}
        >
          {importing ? (
            <IconLoader2 className="motion-safe:animate-spin" />
          ) : null}
          {t(importing ? "editorToolbar.importing" : "home.importMenu.import")}
        </Button>
      </div>
      <GoogleDriveConnectionCta />
      {failed && controller.error ? (
        <p role="alert" className="text-xs text-destructive">
          {controller.error}
        </p>
      ) : null}
    </div>
  );
}
