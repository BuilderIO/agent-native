import {
  useT,
  VisualInspectorPanel,
  VisualInspectorSection,
  VisualTweakControl,
} from "@agent-native/core/client";
import { Button } from "@agent-native/toolkit/ui/button";
import { IconAdjustmentsHorizontal, IconX } from "@tabler/icons-react";

import type { TweakDefinition } from "@/lib/design-systems";

interface TweaksPanelProps {
  tweaks: TweakDefinition[];
  values: Record<string, string | number | boolean>;
  onChange: (id: string, value: string | number | boolean) => void;
  onClose: () => void;
}

export function TweaksPanel({
  tweaks,
  values,
  onChange,
  onClose,
}: TweaksPanelProps) {
  const t = useT();
  return (
    <div className="absolute bottom-4 right-4 z-20">
      <VisualInspectorPanel
        title={t("styleInspector.deckStyle")}
        subtitle={t("styleInspector.designSystemTweaks")}
        className="w-64"
        headerAction={
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 cursor-pointer text-muted-foreground hover:text-foreground"
            onClick={onClose}
            aria-label={t("styleInspector.closeTweaks")}
          >
            <IconX className="size-3.5" />
          </Button>
        }
      >
        <VisualInspectorSection title={t("styleInspector.controls")}>
          {tweaks.length > 0 ? (
            tweaks.map((tweak) => (
              <TweakControl
                key={tweak.id}
                tweak={tweak}
                value={values[tweak.id] ?? tweak.defaultValue}
                onChange={(v) => onChange(tweak.id, v)}
              />
            ))
          ) : (
            <div className="flex flex-col items-center gap-2 py-6 text-center text-[11px] text-muted-foreground">
              <IconAdjustmentsHorizontal className="size-5 text-muted-foreground/40" />
              <span>{t("styleInspector.noDeckStyleControls")}</span>
            </div>
          )}
        </VisualInspectorSection>
      </VisualInspectorPanel>
    </div>
  );
}

function TweakControl({
  tweak,
  value,
  onChange,
}: {
  tweak: TweakDefinition;
  value: string | number | boolean;
  onChange: (v: string | number | boolean) => void;
}) {
  return <VisualTweakControl tweak={tweak} value={value} onChange={onChange} />;
}
