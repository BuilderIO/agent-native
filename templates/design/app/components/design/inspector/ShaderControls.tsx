import { useT } from "@agent-native/core/client/i18n";
import {
  SHADER_PRESET_MAP,
  type ShaderDescriptor,
} from "@shared/shader-presets";

import { cn } from "@/lib/utils";

export interface ShaderControlsProps {
  descriptor: ShaderDescriptor;
  onChange?: (descriptor: ShaderDescriptor) => void;
  onBack?: () => void;
  className?: string;
}

export function ShaderControls({ descriptor, className }: ShaderControlsProps) {
  const t = useT();
  const preset = SHADER_PRESET_MAP[descriptor.preset];
  const values = Object.entries(descriptor.params).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  return (
    <div className={cn("space-y-2 px-3 py-2", className)}>
      <p className="text-xs text-muted-foreground">
        {t("editPanel.shaders.legacyDescriptorOnly")}
      </p>
      <p className="text-xs font-medium text-foreground">
        {preset?.label ?? descriptor.preset}
      </p>
      {values.length > 0 ? (
        <dl className="grid grid-cols-2 gap-x-2 gap-y-1 text-xs">
          {values.map(([name, value]) => (
            <div key={name} className="contents">
              <dt className="truncate text-muted-foreground">{name}</dt>
              <dd className="truncate text-right text-foreground">
                {String(value)}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {descriptor.colors?.length ? (
        <ul
          className="flex gap-1"
          aria-label={t("editPanel.shaders.legacyDescriptorOnly")}
        >
          {descriptor.colors.map((color, index) => (
            <li
              key={`${index}:${color}`}
              className="size-4 rounded-sm border border-border"
              style={{ backgroundColor: color }}
              title={color}
            />
          ))}
        </ul>
      ) : null}
    </div>
  );
}
