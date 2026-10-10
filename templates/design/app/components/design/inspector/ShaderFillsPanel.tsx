import { useT } from "@agent-native/core/client/i18n";
import {
  SHADER_PRESET_MAP,
  type ShaderDescriptor,
  type ShaderPresetDef,
} from "@shared/shader-presets";
import { buildFallbackGradient } from "@shared/shader-safety";
import { IconX } from "@tabler/icons-react";

import { ShaderControls } from "./ShaderControls";

export function descriptorFromPreset(
  preset: ShaderPresetDef,
): ShaderDescriptor {
  const params: Record<string, number | boolean | string> = {};
  for (const property of preset.params) {
    if (property.kind !== "colors" && !Array.isArray(property.default)) {
      params[property.key] = property.default as number | boolean | string;
    }
  }
  return {
    preset: preset.name,
    params,
    colors: preset.defaultColors ?? undefined,
    speed: 0,
    frame: 0,
  };
}

export function shaderDescriptorToCss(descriptor: ShaderDescriptor): string {
  const preset = SHADER_PRESET_MAP[descriptor.preset];
  const colors =
    descriptor.colors && descriptor.colors.length > 0
      ? descriptor.colors
      : (preset?.defaultColors ?? []);
  return buildFallbackGradient(colors, preset?.defaultColorBack);
}

export interface ShaderFillsPanelProps {
  descriptor?: ShaderDescriptor;
  onApply?: (descriptor: ShaderDescriptor, css: string) => void;
  onCommit?: (descriptor: ShaderDescriptor, css: string) => void;
  onBack: () => void;
  applyContext?: {
    designId?: string;
    fileId?: string;
    nodeId?: string;
    selector?: string;
  };
  disabled?: boolean;
}

export function ShaderFillsPanel({
  descriptor,
  onBack,
}: ShaderFillsPanelProps) {
  const t = useT();
  if (!descriptor) return null;
  return (
    <div className="flex flex-col">
      <div className="flex h-6 items-center gap-1.5 px-3">
        <span className="design-sidebar-section-title flex-1 truncate text-foreground">
          {t("editPanel.shaders.fillsTitle")}
        </span>
        <button
          type="button"
          aria-label={t("editPanel.shaders.closePanel")}
          onClick={onBack}
          className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-[var(--design-editor-control-bg)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <IconX className="size-3" />
        </button>
      </div>
      <ShaderControls descriptor={descriptor} />
    </div>
  );
}
