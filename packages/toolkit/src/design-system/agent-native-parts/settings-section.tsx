import type { ModelRow, RowBadge } from "@agent-native/design-system/model";
import { IconCheck, IconChevronDown } from "@tabler/icons-react";
import { useContext, type ReactNode } from "react";

import { useSettingsSurface } from "../../app/settings/SettingsSection.js";
import { Badge } from "../../ui/base-ui/badge.js";
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from "../../ui/base-ui/collapsible.js";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemGroupLabel,
  ItemMedia,
  ItemTitle,
} from "../../ui/base-ui/item.js";
import {
  type PartComponent,
  type PartProps,
  rowAttributes,
  useRowEffect,
  useRowRegions,
  useRowSlot,
} from "../parts.js";
import { Glyph } from "./glyph.js";
import { InSettingsGroupContext } from "./settings-rows.js";

function SectionBadge({
  rowId,
  badge,
  surface,
}: {
  rowId: string;
  badge: RowBadge;
  surface: "page" | "sidebar";
}) {
  if (badge.kind !== "label") {
    throw new Error(
      `Row ${rowId} has a ${badge.kind} badge; settings sections draw label badges`,
    );
  }
  const color =
    badge.tone === "attention" && surface === "page" ? "warning" : "gray";
  return <Badge color={color}>{badge.value}</Badge>;
}

function SectionStatus({
  row,
  surface,
}: {
  row: ModelRow;
  surface: "page" | "sidebar";
}) {
  return (
    <>
      {row.state?.complete ? (
        <Badge color="success" aria-hidden>
          <IconCheck />
        </Badge>
      ) : null}
      {row.state?.badge ? (
        <SectionBadge
          rowId={row.id}
          badge={row.state.badge}
          surface={surface}
        />
      ) : null}
    </>
  );
}

function SettingsSectionPart({ row, children }: PartProps) {
  const surface = useSettingsSurface();
  const grouped = useContext(InSettingsGroupContext);
  const run = useRowEffect(row);
  const slot = useRowSlot(row);
  const { body } = useRowRegions(row, ["body"]);
  const content: ReactNode = (
    <>
      {body}
      {slot}
      {children}
    </>
  );
  const description = row.description ? (
    <ItemDescription>{row.description}</ItemDescription>
  ) : null;

  if (surface === "sidebar") {
    return (
      <Collapsible
        {...rowAttributes(row)}
        open={row.state?.expanded === true}
        onOpenChange={() => run?.()}
      >
        <CollapsibleTrigger render={<Item render={<button type="button" />} />}>
          {row.icon ? (
            <ItemMedia>
              <Glyph icon={row.icon} />
            </ItemMedia>
          ) : null}
          <ItemContent>
            <ItemTitle>
              <span data-rid-label="">{row.label}</span>
            </ItemTitle>
          </ItemContent>
          <ItemActions>
            <SectionStatus row={row} surface={surface} />
            <IconChevronDown className="collapsible-chevron" aria-hidden />
          </ItemActions>
        </CollapsibleTrigger>
        <CollapsiblePanel>
          {description}
          <ItemGroup variant="ghost">{content}</ItemGroup>
        </CollapsiblePanel>
      </Collapsible>
    );
  }

  return (
    <section {...rowAttributes(row)} data-agent-native-settings-page="">
      {grouped ? null : (
        <>
          <ItemGroupLabel>
            <span data-rid-label="">{row.label}</span>
            {row.state?.complete || row.state?.badge ? (
              <>
                {" "}
                <SectionStatus row={row} surface={surface} />
              </>
            ) : null}
          </ItemGroupLabel>
          {description}
        </>
      )}
      {grouped || body !== null ? (
        content
      ) : (
        <ItemGroup variant="outline">{content}</ItemGroup>
      )}
    </section>
  );
}

/** Toolkit's settings section part, keyed by part reference. */
export const SETTINGS_SECTION_PARTS = {
  "settings.section": SettingsSectionPart,
} as const satisfies Record<string, PartComponent>;
