import { useT } from "@agent-native/core/client/i18n";

import type { ElementInfo } from "../types";
import { PanelSection, PropSelect } from "./panel-primitives";
import type { StyleChangeHandler } from "./style-change-types";

export type ImageObjectFitMode = "crop" | "fit" | "stretch";

export function imageObjectFitMode(
  value: string | undefined,
): ImageObjectFitMode {
  if (value === "cover") return "crop";
  if (value === "contain" || value === "scale-down") return "fit";
  return "stretch";
}

export function imageObjectFitValue(mode: ImageObjectFitMode): string {
  switch (mode) {
    case "crop":
      return "cover";
    case "fit":
      return "contain";
    case "stretch":
      return "fill";
  }
}

export function ImageProperties({
  element,
  onStyleChange,
}: {
  element: ElementInfo;
  onStyleChange: StyleChangeHandler;
}) {
  const t = useT();
  const objectFit =
    element.inlineStyles?.objectFit || element.computedStyles.objectFit;
  const mode = imageObjectFitMode(objectFit);

  return (
    <PanelSection title={t("editPanel.labels.image")}>
      <PropSelect
        label={"Resizing" /* i18n-ignore design inspector label */}
        value={mode}
        onChange={(next) =>
          onStyleChange(
            "objectFit",
            imageObjectFitValue(next as ImageObjectFitMode),
          )
        }
        options={[
          { value: "crop", label: "Crop" /* i18n-ignore CSS image fitting */ },
          { value: "fit", label: "Fit" /* i18n-ignore CSS image fitting */ },
          {
            value: "stretch",
            label: "Stretch" /* i18n-ignore CSS image fitting */,
          },
        ]}
      />
    </PanelSection>
  );
}
