import { useT } from "@agent-native/core/client/i18n";
import type {
  EffectInputBinding,
  EffectTextureRef,
} from "@shared/native-effects";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import type { NativeAuthoredLayerOption } from "./native-authored-input-options";
import {
  readNativeCameraState,
  startNativeCamera,
  stopNativeCamera,
  type NativeCameraClientState,
} from "./native-live-camera-client";
import { NativeEffectTextureControl } from "./NativeEffectTextureControl";

export type NativeEffectInputChoice =
  | EffectInputBinding
  | {
      kind: "authored-selector";
      selector: string;
      capture: "content" | "appearance";
    }
  | null;

export function NativeEffectInputControls({
  label,
  binding,
  assetValue,
  layers,
  defaultAvailable,
  disabled,
  designId,
  fileId,
  cameraAvailable = false,
  cameraInputActive = true,
  cameraFileId,
  cameraBoardFile = false,
  cameraInstanceId,
  cameraPort,
  onChange,
}: {
  label: string;
  binding: NativeEffectInputChoice;
  assetValue: EffectTextureRef | null;
  layers: NativeAuthoredLayerOption[];
  defaultAvailable: boolean;
  disabled: boolean;
  designId?: string;
  fileId?: string;
  cameraAvailable?: boolean;
  cameraInputActive?: boolean;
  cameraFileId?: string;
  cameraBoardFile?: boolean;
  cameraInstanceId?: string;
  cameraPort?: string;
  onChange: (binding: NativeEffectInputChoice) => void;
}) {
  const t = useT();
  const [wantsImage, setWantsImage] = useState(false);
  useEffect(() => setWantsImage(false), [binding?.kind]);
  const [cameraState, setCameraState] =
    useState<NativeCameraClientState>("idle");
  useEffect(() => {
    if (binding?.kind !== "camera" || !cameraFileId || !cameraInputActive)
      return;
    const refresh = () => {
      try {
        setCameraState(readNativeCameraState(cameraFileId, cameraBoardFile));
      } catch {
        setCameraState("unavailable");
      }
    };
    refresh();
    window.addEventListener("an-native-camera-state", refresh);
    return () => window.removeEventListener("an-native-camera-state", refresh);
  }, [binding?.kind, cameraFileId, cameraBoardFile, cameraInputActive]);
  const source = wantsImage
    ? "image"
    : binding?.kind === "camera"
      ? "camera"
      : binding?.kind === "authored-node"
        ? `node:${binding.nodeId}`
        : binding?.kind === "authored-selector"
          ? `selector:${binding.selector}`
          : binding?.kind === "asset" || assetValue
            ? "image"
            : defaultAvailable
              ? "default"
              : "missing";
  const selectedLayer = layers.some((layer) => layer.key === source);
  const image = binding?.kind === "asset" ? binding : assetValue;
  return (
    <div className="grid gap-1">
      <span className="text-xs">{label}</span>
      <Select
        value={source}
        disabled={disabled}
        onValueChange={(value) => {
          if (value === "image") {
            setWantsImage(true);
            return;
          }
          setWantsImage(false);
          if (value === "camera") {
            onChange({ kind: "camera" });
            return;
          }
          if (value === "default") {
            onChange(null);
            return;
          }
          const layer = layers.find((candidate) => candidate.key === value);
          if (layer)
            onChange(
              layer.nodeId
                ? {
                    kind: "authored-node",
                    nodeId: layer.nodeId,
                    capture: "content",
                  }
                : {
                    kind: "authored-selector",
                    selector: layer.selector,
                    capture: "content",
                  },
            );
        }}
      >
        <SelectTrigger className="h-7 w-full text-xs" aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="default" disabled={!defaultAvailable}>
            {t("editPanel.shaders.nativeInputDefault")}
          </SelectItem>
          <SelectItem value="image">
            {t("editPanel.shaders.nativeInputImage")}
          </SelectItem>
          {(cameraAvailable || binding?.kind === "camera") && (
            <SelectItem value="camera" disabled={!cameraAvailable}>
              {t("editPanel.shaders.nativeInputCamera")}
            </SelectItem>
          )}
          {!defaultAvailable && (
            <SelectItem value="missing" disabled>
              {t("editPanel.shaders.nativeTextureSelect")}
            </SelectItem>
          )}
          {layers.map((layer) => (
            <SelectItem key={layer.key} value={layer.key}>
              {layer.name || t("editPanel.shaders.nativeInputUnnamedLayer")}
            </SelectItem>
          ))}
          {binding?.kind === "authored-node" && !selectedLayer && (
            <SelectItem value={source} disabled>
              {t("editPanel.shaders.nativeInputLayerUnavailable")}
            </SelectItem>
          )}
        </SelectContent>
      </Select>
      {source === "camera" &&
        cameraInputActive &&
        cameraFileId &&
        cameraInstanceId &&
        cameraPort && (
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              disabled={
                disabled || !cameraAvailable || cameraState === "starting"
              }
              onClick={() => {
                if (cameraState === "active") {
                  try {
                    stopNativeCamera(cameraFileId, cameraBoardFile);
                    setCameraState("stopped");
                  } catch {
                    setCameraState("unavailable");
                  }
                  return;
                }
                setCameraState("starting");
                void startNativeCamera(
                  cameraFileId,
                  cameraBoardFile,
                  cameraInstanceId,
                  cameraPort,
                ).then(
                  () => setCameraState("active"),
                  (error: unknown) => {
                    const code =
                      error && typeof error === "object" && "code" in error
                        ? (error as { code: unknown }).code
                        : null;
                    setCameraState(
                      code === "permission-denied"
                        ? "permission-denied"
                        : code === "stopped"
                          ? "stopped"
                          : "unavailable",
                    );
                  },
                );
              }}
            >
              {t(
                cameraState === "active"
                  ? "editPanel.shaders.nativeInputCameraStop"
                  : "editPanel.shaders.nativeInputCameraStart",
              )}
            </Button>
            {(cameraState === "permission-denied" ||
              cameraState === "unavailable" ||
              cameraState === "stopped") && (
              <span role="status" className="text-xs text-muted-foreground">
                {t(
                  cameraState === "permission-denied"
                    ? "editPanel.shaders.nativeInputCameraPermissionDenied"
                    : cameraState === "stopped"
                      ? "editPanel.shaders.nativeInputCameraStopped"
                      : "editPanel.shaders.nativeInputCameraUnavailable",
                )}
              </span>
            )}
          </div>
        )}
      {(source === "image" || source === "missing") && (
        <NativeEffectTextureControl
          designId={designId}
          fileId={fileId}
          label={label}
          value={image}
          disabled={disabled}
          onChange={(value) => {
            if (value) {
              onChange(value);
              setWantsImage(false);
            } else {
              onChange(null);
              setWantsImage(false);
            }
          }}
        />
      )}
      {(source.startsWith("node:") || source.startsWith("selector:")) &&
        (binding?.kind === "authored-node" ||
          binding?.kind === "authored-selector") && (
          <Select
            value={binding.capture}
            disabled={disabled}
            onValueChange={(capture) => {
              if (capture === "content" || capture === "appearance")
                onChange({ ...binding, capture });
            }}
          >
            <SelectTrigger
              className="h-7 w-full text-xs"
              aria-label={t("editPanel.shaders.nativeInputLayer")}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="content">
                {t("editPanel.shaders.nativeInputContent")}
              </SelectItem>
              <SelectItem value="appearance">
                {t("editPanel.shaders.nativeInputAppearance")}
              </SelectItem>
            </SelectContent>
          </Select>
        )}
    </div>
  );
}
