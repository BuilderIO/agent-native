import { useT } from "@agent-native/core/client/i18n";
import type {
  EffectInputBinding,
  EffectTextureRef,
} from "@shared/native-effects";
import { useState } from "react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import type { NativeAuthoredLayerOption } from "./native-authored-input-options";
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
  onChange,
}: {
  label: string;
  binding: EffectInputBinding | null;
  assetValue: EffectTextureRef | null;
  layers: NativeAuthoredLayerOption[];
  defaultAvailable: boolean;
  disabled: boolean;
  designId?: string;
  fileId?: string;
  onChange: (binding: NativeEffectInputChoice) => void;
}) {
  const t = useT();
  const [wantsImage, setWantsImage] = useState(false);
  const source = wantsImage
    ? "image"
    : binding?.kind === "authored-node"
      ? `node:${binding.nodeId}`
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
      {source.startsWith("node:") && binding?.kind === "authored-node" && (
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
