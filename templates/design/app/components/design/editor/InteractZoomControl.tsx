import { useT } from "@agent-native/core/client/i18n";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  INTERACT_ZOOM_FIT,
  INTERACT_ZOOM_STEPS,
  formatInteractZoomLabel,
  isInteractZoomChoice,
  type InteractZoomChoice,
} from "@/pages/design-editor/interact-zoom";

import { TOP_BAR_SELECT_TRIGGER_CLASS } from "./top-bar-controls";

const MENU_CONTENT_Z = "z-[100030]";

/**
 * The only way to zoom the Interact preview: the wheel, a pinch, a drag and the
 * zoom shortcuts all belong to the page. The label always reads the scale the
 * preview is at, so Fit shows the percentage it resolved to.
 */
export function InteractZoomControl({
  zoom,
  choice,
  onChange,
}: {
  zoom: number;
  choice: InteractZoomChoice;
  onChange: (choice: InteractZoomChoice) => void;
}) {
  const t = useT();
  return (
    <Select
      value={String(choice)}
      onValueChange={(next) => {
        const parsed = next === INTERACT_ZOOM_FIT ? next : Number(next);
        if (isInteractZoomChoice(parsed)) onChange(parsed);
      }}
    >
      <SelectTrigger
        size="sm"
        data-design-interact-zoom
        aria-label={t("designEditor.responsiveInteract.zoom")}
        className={cn(TOP_BAR_SELECT_TRIGGER_CLASS, "tabular-nums")}
      >
        <SelectValue>{formatInteractZoomLabel(zoom)}</SelectValue>
      </SelectTrigger>
      <SelectContent className={MENU_CONTENT_Z}>
        <SelectItem value={INTERACT_ZOOM_FIT} className="!text-xs">
          {t("designEditor.responsiveInteract.zoomFitOption")}
        </SelectItem>
        {INTERACT_ZOOM_STEPS.map((step) => (
          <SelectItem
            key={step}
            value={String(step)}
            className="!text-xs tabular-nums"
          >
            {formatInteractZoomLabel(step)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
