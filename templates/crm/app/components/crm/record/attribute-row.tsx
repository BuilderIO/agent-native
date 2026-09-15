/**
 * The label/value row shared by the record's object attributes and by a list
 * entry's own attributes. One shell, so a pipeline value and a record value
 * cannot drift into looking like two different products.
 *
 * Geometry: a 30%/1fr split, a 20px icon box with a 14px glyph at a 7px gap,
 * and a hairline under every row but the last.
 */

import {
  IconActivity,
  IconAlignLeft,
  IconCalendar,
  IconCircleDot,
  IconClock,
  IconCurrencyDollar,
  IconHash,
  IconId,
  IconLink,
  IconMail,
  IconMapPin,
  IconPhone,
  IconSquareCheck,
  IconStar,
  IconTag,
  IconUser,
  IconWorld,
} from "@tabler/icons-react";

import { overlayProps } from "@/components/crm/shared/ui-tokens";

import type { CrmAttributeType } from "../../../../shared/crm-attributes";

const TYPE_ICONS: Record<CrmAttributeType, typeof IconAlignLeft> = {
  text: IconAlignLeft,
  number: IconHash,
  checkbox: IconSquareCheck,
  currency: IconCurrencyDollar,
  date: IconCalendar,
  timestamp: IconClock,
  rating: IconStar,
  status: IconCircleDot,
  select: IconTag,
  "record-reference": IconLink,
  "actor-reference": IconUser,
  location: IconMapPin,
  domain: IconWorld,
  "email-address": IconMail,
  "phone-number": IconPhone,
  interaction: IconActivity,
  "personal-name": IconId,
};

/** Section headings sit at body size in the secondary content color — the same
 *  relationship the grid's column headers use. Small uppercase micro-labels are
 *  the tell we are moving away from. */
export const PANEL_SECTION_HEADING =
  "text-sm font-medium text-content-secondary";

export function AttributeTypeIcon({ type }: { type: CrmAttributeType }) {
  const Icon = TYPE_ICONS[type] ?? IconAlignLeft;
  return (
    <span
      aria-hidden
      className="grid size-5 shrink-0 place-items-center text-content-tertiary"
    >
      <Icon className="size-3.5" />
    </span>
  );
}

/**
 * `min-h-9` rather than a fixed 36px: a long attribute name ("Desired Cadence
 * Days") in a 30% column has to go somewhere, and truncating it hides the one
 * piece of text the row exists to identify. The row grows; it never clips.
 */
export function AttributeRowShell({
  type,
  label,
  title,
  affordance,
  children,
}: {
  type: CrmAttributeType;
  label: string;
  title?: string;
  affordance?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      {...overlayProps({
        className:
          "group grid min-h-9 grid-cols-[30%_1fr] items-center gap-2 rounded-card py-1 pl-[7px] pr-3 [&:not(:last-child)]:border-b [&:not(:last-child)]:border-hairline",
      })}
      title={title}
    >
      <div className="flex min-w-0 items-center gap-[7px]">
        <AttributeTypeIcon type={type} />
        <span className="min-w-0 break-words text-sm text-content-secondary">
          {label}
        </span>
        {affordance}
      </div>
      <div className="min-w-0 text-sm">{children}</div>
    </div>
  );
}
