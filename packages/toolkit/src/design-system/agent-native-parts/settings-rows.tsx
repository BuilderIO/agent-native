import type { RowBadge } from "@agent-native/design-system/model";
import { IconAlertTriangle } from "@tabler/icons-react";
import { createContext, type ReactNode } from "react";

import { Badge } from "../../ui/base-ui/badge.js";
import {
  Callout,
  CalloutActions,
  CalloutIcon,
  CalloutText,
} from "../../ui/base-ui/callout.js";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemFooter,
  ItemGroup,
  ItemGroupLabel,
  ItemMedia,
  ItemTitle,
} from "../../ui/base-ui/item.js";
import { Switch } from "../../ui/base-ui/switch.js";
import {
  type PartComponent,
  type PartProps,
  rowAttributes,
  useRowEffect,
  useRowRegions,
  useRowSlot,
} from "../parts.js";
import { Glyph } from "./glyph.js";

/** True inside a `settings.group`'s body, where sections drop their own chrome. */
export const InSettingsGroupContext = createContext(false);

function SettingsGroupPart({ row, children }: PartProps) {
  const slot = useRowSlot(row);
  return (
    <section {...rowAttributes(row)}>
      <ItemGroupLabel
        data-rid-label=""
        visuallyHidden={row.labelHidden === true}
      >
        {row.label}
      </ItemGroupLabel>
      {row.description && !row.labelHidden ? (
        <ItemDescription>{row.description}</ItemDescription>
      ) : null}
      <ItemGroup variant="outline">
        <InSettingsGroupContext.Provider value={true}>
          {slot}
          {children}
        </InSettingsGroupContext.Provider>
      </ItemGroup>
    </section>
  );
}

function RowBadgeView({ rowId, badge }: { rowId: string; badge: RowBadge }) {
  if (badge.kind === "dot") {
    throw new Error(
      `Row ${rowId} has a dot badge, which settings rows do not draw`,
    );
  }
  return (
    <Badge variant="outline" color="gray">
      {badge.value}
    </Badge>
  );
}

function SettingsRowPart({ row, children }: PartProps) {
  const run = useRowEffect(row);
  const slot = useRowSlot(row);
  const regions = useRowRegions(row, [
    "label",
    "description",
    "status",
    "detail",
  ]);
  const pending = row.state?.pending === true;
  const toggle =
    row.kind === "toggle" ? (
      <Switch
        aria-label={row.label}
        checked={row.state?.checked === true}
        disabled={row.state?.disabled === true || pending}
        aria-busy={pending ? true : undefined}
        onCheckedChange={() => run?.()}
      />
    ) : null;
  const control: ReactNode =
    toggle || slot || children ? (
      <>
        {toggle}
        {slot}
        {children}
      </>
    ) : null;
  const description = regions.description ?? row.description;
  return (
    <Item {...rowAttributes(row)}>
      {row.icon ? (
        <ItemMedia framed>
          <Glyph icon={row.icon} />
        </ItemMedia>
      ) : null}
      <ItemContent>
        <ItemTitle>
          <span data-rid-label="">{regions.label ?? row.label}</span>
          {row.state?.badge ? (
            <RowBadgeView rowId={row.id} badge={row.state.badge} />
          ) : null}
          {regions.status}
        </ItemTitle>
        {description ? <ItemDescription>{description}</ItemDescription> : null}
      </ItemContent>
      {control ? <ItemActions>{control}</ItemActions> : null}
      {regions.detail ? <ItemFooter>{regions.detail}</ItemFooter> : null}
    </Item>
  );
}

function SettingsNoticePart({ row, children }: PartProps) {
  const slot = useRowSlot(row);
  useRowRegions(row, []);
  if (row.description) {
    throw new Error(
      `Row ${row.id} is settings.notice with a description; a notice's message is its label`,
    );
  }
  return (
    <Callout {...rowAttributes(row)} variant="surface" color="warning">
      <CalloutIcon>
        {row.icon ? <Glyph icon={row.icon} /> : <IconAlertTriangle />}
      </CalloutIcon>
      <CalloutText>
        <span data-rid-label="">{row.label}</span>
      </CalloutText>
      {slot || children ? (
        <CalloutActions>
          {slot}
          {children}
        </CalloutActions>
      ) : null}
    </Callout>
  );
}

function SettingsContentPart({ row }: PartProps) {
  const slot = useRowSlot(row);
  if (!row.slot) {
    throw new Error(`Row ${row.id} is settings.content with no slot to draw`);
  }
  return <>{slot}</>;
}

/** Toolkit's settings rows parts, keyed by part reference. */
export const SETTINGS_ROW_PARTS = {
  "settings.group": SettingsGroupPart,
  "settings.row": SettingsRowPart,
  "settings.notice": SettingsNoticePart,
  "settings.content": SettingsContentPart,
} as const satisfies Record<string, PartComponent>;
