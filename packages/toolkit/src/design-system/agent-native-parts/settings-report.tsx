import {
  ItemGroup,
  ItemGroupHeader,
  ItemGroupLabel,
} from "../../ui/base-ui/item.js";
import {
  type PartComponent,
  type PartProps,
  rowAttributes,
  useRowRegions,
  useRowSlot,
} from "../parts.js";

function SettingsReportPart({ row, children }: PartProps) {
  const slot = useRowSlot(row);
  const { action, body } = useRowRegions(row, ["action", "body"]);
  return (
    <section {...rowAttributes(row)}>
      <ItemGroupHeader>
        <ItemGroupLabel data-rid-label="">{row.label}</ItemGroupLabel>
        {action}
      </ItemGroupHeader>
      {body === null ? (
        <ItemGroup variant="outline">
          {children}
          {slot}
        </ItemGroup>
      ) : (
        <>
          {body}
          {children}
          {slot}
        </>
      )}
    </section>
  );
}

/** Toolkit's report part, keyed by part reference. */
export const SETTINGS_REPORT_PARTS = {
  "settings.report": SettingsReportPart,
} as const satisfies Record<string, PartComponent>;
