import { sendToAgentChat } from "@agent-native/core/client/agent-chat";
import { useT } from "@agent-native/core/client/i18n";
import { IconCopy, IconRefresh } from "@tabler/icons-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { loadDesignReferenceCopy } from "@/lib/design-reference-copy";

import { FrameRecoveryControls } from "./FrameRecoveryControls";

export function ExternalReferenceFallback({
  url,
  designId,
  screenId,
  bridgeUrl,
  previewToken,
  snapshotHtml,
  failed,
  compact,
  active,
  onReferenceChange,
}: {
  url: string;
  designId?: string | undefined;
  screenId?: string | undefined;
  bridgeUrl?: string | undefined;
  previewToken?: string | undefined;
  snapshotHtml?: string | undefined;
  failed: boolean;
  compact: boolean;
  active: boolean;
  onReferenceChange: (active: boolean) => void;
}) {
  const t = useT();
  const [html, setHtml] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const [controller] = useState(() => new AbortController());
  useEffect(() => () => controller.abort(), [controller]);
  useEffect(() => {
    onReferenceChange(html !== null);
  }, [html, onReferenceChange]);
  // A frame blocked by X-Frame-Options still fires load, so a loaded preview
  // keeps the compact recovery toolbar even though it is not marked failed.
  if (!failed && !compact && html === null) return null;
  const compactControls = html !== null || compact;
  return (
    <div
      data-design-reference-fallback
      className={
        html
          ? "absolute inset-0 z-30 bg-background"
          : compact
            ? "pointer-events-none absolute inset-0 z-30"
            : "absolute inset-0 z-30 flex items-center justify-center bg-background/95"
      }
    >
      {html !== null ? (
        <iframe
          data-design-reference-copy
          srcDoc={html}
          sandbox=""
          referrerPolicy="no-referrer"
          title={t("designEditor.referenceCopy.label")}
          className="h-full w-full border-0"
        />
      ) : null}
      <FrameRecoveryControls active={active}>
        <div
          className={
            compactControls
              ? "pointer-events-auto flex w-max flex-wrap items-center gap-2 rounded-md border border-border bg-background px-2 py-1 text-xs"
              : "flex max-w-sm flex-col items-center gap-2 p-4 text-center text-xs"
          }
        >
          {!compact || html || error ? (
            <span
              role="status"
              title={
                html ? t("designEditor.referenceCopy.staticNotice") : undefined
              }
            >
              {t(
                html
                  ? "designEditor.referenceCopy.label"
                  : error
                    ? "designEditor.referenceCopy.failed"
                    : "designEditor.referenceCopy.unavailable",
              )}
            </span>
          ) : null}
          {html === null ? (
            <>
              <Button
                size="sm"
                variant="outline"
                disabled={pending || !bridgeUrl || !previewToken}
                title={
                  !bridgeUrl || !previewToken
                    ? t("designEditor.referenceCopy.noBridge")
                    : undefined
                }
                onClick={() => {
                  if (!bridgeUrl || !previewToken) return;
                  setPending(true);
                  setError(false);
                  void loadDesignReferenceCopy({
                    bridgeUrl,
                    previewToken,
                    url,
                    signal: controller.signal,
                  })
                    .then((copy) => setHtml(copy.html))
                    .catch(() => setError(true))
                    .finally(() => setPending(false));
                }}
              >
                <IconCopy className="size-3.5" />
                {t(
                  pending
                    ? "designEditor.referenceCopy.loading"
                    : "designEditor.referenceCopy.load",
                )}
              </Button>
              {(!bridgeUrl || !previewToken) && !compact ? (
                <span>{t("designEditor.referenceCopy.noBridge")}</span>
              ) : null}
              {snapshotHtml ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setHtml(snapshotHtml)}
                >
                  {t("designEditor.referenceCopy.snapshot")}
                </Button>
              ) : !compact ? (
                <span>{t("designEditor.referenceCopy.capture")}</span>
              ) : null}
            </>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setHtml(null)}>
              <IconRefresh className="size-3.5" />
              {t("designEditor.referenceCopy.original")}
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              sendToAgentChat({
                message: t("designEditor.referenceCopy.capturePrompt"),
                context: JSON.stringify({
                  designId,
                  screenId,
                  referenceUrl: url,
                }),
                submit: true,
                openSidebar: true,
              })
            }
          >
            {t("designEditor.referenceCopy.captureAction")}
          </Button>
        </div>
      </FrameRecoveryControls>
    </div>
  );
}
