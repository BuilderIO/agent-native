import { useFormatters, useT } from "@agent-native/core/client/i18n";
import { useEffect, useState } from "react";

import {
  NativeColorPreviewError,
  readNativeColorCapability,
} from "@/components/design/inspector/native-color-preview-client";
import {
  NativePreviewPolicyError,
  readNativePreviewStatusFromFrame,
  type NativePreviewStatus,
} from "@/components/design/inspector/native-preview-policy-client";
import { EditorShaderPreferencesTab } from "@/components/settings/EditorShaderPreferencesTab";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import type { NativeColorCapability } from "../bridge/native-color-mode";
import { NativeShaderPreferencesFrameError } from "./native-shader-preferences-frame";

type ReadResult<T> =
  | { status: "ready"; value: T }
  | { status: "unavailable"; code: string };
type Diagnostics = {
  frameKey: string;
  preview: ReadResult<NativePreviewStatus>;
  color: ReadResult<NativeColorCapability>;
};

function NativeShaderPreviewDiagnostics({
  open,
  frameKey,
  resolveFrame,
}: {
  open: boolean;
  frameKey: string;
  resolveFrame: () => HTMLIFrameElement;
}) {
  const t = useT();
  const { formatNumber } = useFormatters();
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);

  useEffect(() => {
    if (!open) return;
    const read = () => {
      let frame: HTMLIFrameElement;
      try {
        frame = resolveFrame();
      } catch (error) {
        const code =
          error instanceof NativeShaderPreferencesFrameError
            ? error.code
            : "frame-unavailable";
        setDiagnostics({
          frameKey,
          preview: { status: "unavailable", code },
          color: { status: "unavailable", code },
        });
        return;
      }
      let preview: ReadResult<NativePreviewStatus>;
      let color: ReadResult<NativeColorCapability>;
      try {
        preview = {
          status: "ready",
          value: readNativePreviewStatusFromFrame(frame),
        };
      } catch (error) {
        preview = {
          status: "unavailable",
          code:
            error instanceof NativePreviewPolicyError
              ? error.code
              : "status-unreadable",
        };
      }
      try {
        color = { status: "ready", value: readNativeColorCapability(frame) };
      } catch (error) {
        color = {
          status: "unavailable",
          code:
            error instanceof NativeColorPreviewError
              ? error.code
              : "capability-unreadable",
        };
      }
      setDiagnostics({ frameKey, preview, color });
    };
    read();
    const timer = window.setInterval(read, 2_000);
    window.addEventListener("design-native-shader-frame-load", read);
    window.addEventListener("design-native-shader-status", read);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("design-native-shader-frame-load", read);
      window.removeEventListener("design-native-shader-status", read);
    };
  }, [frameKey, open, resolveFrame]);

  const current = diagnostics?.frameKey === frameKey ? diagnostics : null;
  const format = (value: number) =>
    formatNumber(value, { maximumFractionDigits: 1 });
  return (
    <div
      className="grid gap-1 pt-2 text-xs text-muted-foreground"
      role="status"
    >
      {current?.preview.status === "ready" ? (
        <>
          <p>
            {t("editPanel.shaders.nativePreviewActualResolution", {
              ratio: format(current.preview.value.effectivePixelRatio),
              dpr: format(current.preview.value.devicePixelRatio),
            })}
          </p>
          {current.preview.value.rafIntervalMs !== undefined && (
            <p>
              {t("editPanel.shaders.nativePreviewObservedCadence", {
                ms: format(current.preview.value.rafIntervalMs),
              })}
            </p>
          )}
          {current.preview.value.renderWallMs !== undefined && (
            <p>
              {t("editPanel.shaders.nativePreviewRenderWall", {
                ms: format(current.preview.value.renderWallMs),
              })}
            </p>
          )}
        </>
      ) : (
        <p
          data-native-preview-error={
            current?.preview.status === "unavailable"
              ? current.preview.code
              : undefined
          }
        >
          {t("editPanel.shaders.nativePreviewStatusUnreadable")}
        </p>
      )}
      {current?.color.status === "ready" ? (
        <>
          <p>
            {t("editPanel.shaders.nativeOutputColor")}:{" "}
            {current.color.value.presented === "display-p3"
              ? t("editPanel.shaders.nativeColorP3")
              : "sRGB"}
            {current.color.value.requested !== current.color.value.presented &&
              ` · ${t("editPanel.shaders.nativeColorFallback")}`}
          </p>
          <p>
            {t("editPanel.shaders.nativeDynamicRange")}:{" "}
            {current.color.value.presentedDynamicRange === "hdr"
              ? t("editPanel.shaders.nativeDynamicRangeHdr")
              : current.color.value.presentedDynamicRange === "sdr"
                ? t("editPanel.shaders.nativeDynamicRangeSdr")
                : t("editPanel.shaders.nativeHdrUnavailable")}
            {current.color.value.requestedDynamicRange === "hdr" &&
              current.color.value.presentedDynamicRange !== "hdr" &&
              ` · ${t("editPanel.shaders.nativeHdrFallback")}`}
          </p>
          {current.color.value.presentedDynamicRange !== undefined && (
            <p>
              {current.color.value.displayDynamicRangeCapability ===
              "high-capable"
                ? current.color.value.presentedDynamicRange === "hdr"
                  ? t("editPanel.shaders.nativeDisplayHighCapableHdr")
                  : t("editPanel.shaders.nativeDisplayHighCapable")
                : current.color.value.displayDynamicRangeCapability ===
                    "standard-only"
                  ? t("editPanel.shaders.nativeDisplayStandardOnly")
                  : t("editPanel.shaders.nativeDisplayRangeUnreadable")}
            </p>
          )}
          {current.color.value.presentedDynamicRange === "sdr" && (
            <p>
              {current.color.value.canvasToneMappingStandard === "observed"
                ? t("editPanel.shaders.nativeStandardToneMappingObserved")
                : t("editPanel.shaders.nativeToneMappingUnreadable")}
            </p>
          )}
          <p>{t("editPanel.shaders.nativeColorSourceLimit")}</p>
        </>
      ) : (
        <p
          data-native-color-error={
            current?.color.status === "unavailable"
              ? current.color.code
              : undefined
          }
        >
          {t("editPanel.shaders.nativeColorModeUnavailable")}
        </p>
      )}
    </div>
  );
}

export function NativeShaderPreferencesDialog({
  open,
  onOpenChange,
  frameKey,
  resolveFrame,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  frameKey: string;
  resolveFrame: () => HTMLIFrameElement;
}) {
  const t = useT();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("settings.editorPreferences")}</DialogTitle>
        </DialogHeader>
        <EditorShaderPreferencesTab
          liveDiagnostics={
            <NativeShaderPreviewDiagnostics
              open={open}
              frameKey={frameKey}
              resolveFrame={resolveFrame}
            />
          }
        />
      </DialogContent>
    </Dialog>
  );
}
