import { useT } from "@agent-native/core/client/i18n";
import {
  IconAbc,
  IconAlertTriangle,
  IconCalendar,
  IconCheck,
  IconClock,
  IconClockExclamation,
  IconCopy,
  IconCurrencyDollar,
  IconExternalLink,
  IconId,
  IconLink,
  IconMail,
  IconMapPin,
  IconMessage,
  IconNumbers,
  IconPhone,
  IconProgressCheck,
  IconSelector,
  IconSquareCheck,
  IconStar,
  IconStarFilled,
  IconUser,
  IconWorld,
} from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Checkbox } from "@/components/ui/checkbox";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

import type { CrmAttributeType } from "../../../../shared/crm-attributes";
import {
  activeOptions,
  attributeInputValue,
  editorInputType,
  RATING_MAX,
  referenceMembers,
  referenceSearchKind,
  valueTokens,
  type CrmValueToken,
} from "../shared/attribute-value";
import { AttributeRating } from "../shared/AttributeValueParts";
import { RecordReferencePicker } from "../shared/RecordReferencePicker";
import { overlayProps } from "../shared/ui-tokens";
import {
  cellSpecFor,
  formatCell,
  statusOverrunDays,
  type CrmCellProvenance,
  type CrmCellValue,
  type CrmGridAttribute,
} from "./model";
import { resolveGridKey, type GridDirection } from "./navigation";

type Translate = ReturnType<typeof useT>;

const EMPTY = "—";

// ---------------------------------------------------------------------------
// Header affordances
// ---------------------------------------------------------------------------

/** The leading glyph on a column header: the attribute's type, not its name. */
const TYPE_ICONS: Record<
  CrmAttributeType,
  React.ComponentType<{ className?: string }>
> = {
  text: IconAbc,
  number: IconNumbers,
  checkbox: IconSquareCheck,
  currency: IconCurrencyDollar,
  date: IconCalendar,
  timestamp: IconClock,
  rating: IconStar,
  status: IconProgressCheck,
  select: IconSelector,
  "record-reference": IconLink,
  "actor-reference": IconUser,
  location: IconMapPin,
  domain: IconWorld,
  "email-address": IconMail,
  "phone-number": IconPhone,
  interaction: IconMessage,
  "personal-name": IconId,
};

export function AttributeTypeIcon({
  type,
  className,
}: {
  type: CrmAttributeType;
  className?: string;
}) {
  const Icon = TYPE_ICONS[type] ?? IconAbc;
  return <Icon className={className} />;
}

// ---------------------------------------------------------------------------
// Avatars
// ---------------------------------------------------------------------------

export type CrmAvatarShape = "person" | "company";

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "";
  const first = words[0]?.[0] ?? "";
  const second = words.length > 1 ? (words[words.length - 1]?.[0] ?? "") : "";
  return `${first}${second}`;
}

/**
 * A record's avatar. Shape carries the object type — a round avatar is a
 * person, a squircle is an organisation — so the two never have to be labelled.
 */
export function RecordAvatar({
  name,
  shape,
  className,
}: {
  name: string;
  shape: CrmAvatarShape;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-5 shrink-0 items-center justify-center bg-muted text-[10px] font-medium uppercase leading-none text-content-secondary ring-1 ring-inset ring-hairline",
        shape === "person" ? "rounded-full" : "rounded-avatar-company",
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Provenance
// ---------------------------------------------------------------------------

const PROVENANCE_TINT: Record<CrmCellProvenance["actorType"], string> = {
  user: "",
  agent: "bg-violet-500/70",
  automation: "bg-amber-500/70",
  provider: "bg-sky-500/70",
  system: "bg-muted-foreground/40",
};

/**
 * A 5px corner wedge, not a badge. Provenance has to be legible at a glance
 * across a whole screen of cells without competing with the values themselves.
 */
export function ProvenanceMarker({
  provenance,
  attributeLabel,
}: {
  provenance: CrmCellProvenance | undefined;
  attributeLabel: string;
}) {
  const t = useT();
  if (!provenance) return null;
  if (provenance.readable && provenance.actorType === "user") return null;
  const tint = provenance.readable
    ? PROVENANCE_TINT[provenance.actorType]
    : "bg-destructive/70";
  if (!tint) return null;
  return (
    <HoverCard openDelay={220}>
      <HoverCardTrigger asChild>
        <span
          className="absolute bottom-0 right-0 size-0 cursor-help border-b-[5px] border-l-[5px] border-l-transparent"
          style={{ borderBottomColor: "transparent" }}
          aria-label={t("grid.provenanceOf", { attribute: attributeLabel })}
        >
          <span
            className={cn("absolute -bottom-[5px] right-0 size-[5px]", tint)}
            style={{ clipPath: "polygon(100% 0, 100% 100%, 0 100%)" }}
          />
        </span>
      </HoverCardTrigger>
      <HoverCardContent align="end" className="w-72 text-xs">
        {provenance.readable ? (
          <dl className="grid gap-1.5">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-muted-foreground">{t("grid.provSetBy")}</dt>
              <dd className="font-medium">
                {t(`grid.actor.${provenance.actorType}`)}
              </dd>
            </div>
            {provenance.source ? (
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">
                  {t("grid.provSource")}
                </dt>
                <dd className="truncate font-medium">{provenance.source}</dd>
              </div>
            ) : null}
            {provenance.observedAt ? (
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">{t("grid.provWhen")}</dt>
                <dd>{new Date(provenance.observedAt).toLocaleString()}</dd>
              </div>
            ) : null}
            {typeof provenance.confidence === "number" ? (
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">
                  {t("grid.provConfidence")}
                </dt>
                <dd>{Math.round(provenance.confidence * 100)}%</dd>
              </div>
            ) : null}
            {provenance.reasoning ? (
              <div className="mt-1 border-t border-border/60 pt-1.5">
                <dt className="sr-only">{t("grid.provReasoning")}</dt>
                <dd className="leading-5 text-muted-foreground">
                  {provenance.reasoning}
                </dd>
              </div>
            ) : null}
            {provenance.sourceUrl ? (
              <a
                href={provenance.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-1 inline-flex items-center gap-1 font-medium text-foreground underline-offset-2 hover:underline"
              >
                {t("grid.provOpenSource")}
                <IconExternalLink className="size-3" />
              </a>
            ) : null}
          </dl>
        ) : (
          <p className="flex items-start gap-2 leading-5 text-muted-foreground">
            <IconAlertTriangle className="mt-0.5 size-3.5 shrink-0 text-destructive" />
            {t("grid.provUnreadable")}
          </p>
        )}
      </HoverCardContent>
    </HoverCard>
  );
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

function copyToClipboard(text: string, t: Translate) {
  void navigator.clipboard
    .writeText(text)
    .then(() => toast.success(t("grid.copied")))
    .catch(() => toast.error(t("grid.copyFailed")));
}

/**
 * A record reference. Hover tint rides the shared overlay rather than a
 * background swap so it composites over a tinted row exactly like every other
 * hover in the app.
 */
function Chip({
  children,
  avatar,
  onCopy,
  href,
}: {
  children: React.ReactNode;
  avatar?: React.ReactNode;
  onCopy?: () => void;
  href?: string;
}) {
  return (
    <span
      {...overlayProps({
        className:
          "inline-flex max-w-full items-center gap-1.5 self-start rounded-chip py-0.5 pl-1 pr-1.5 text-sm before:duration-[var(--motion-breezy)]",
      })}
    >
      {avatar}
      <span className="min-w-0 truncate">{children}</span>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 text-content-ghost hover:text-foreground"
          onClick={(event) => event.stopPropagation()}
        >
          <IconExternalLink className="size-3.5" />
        </a>
      ) : null}
      {onCopy ? (
        <button
          type="button"
          className="shrink-0 cursor-pointer text-content-ghost hover:text-foreground"
          onClick={(event) => {
            event.stopPropagation();
            onCopy();
          }}
        >
          <IconCopy className="size-3.5" />
        </button>
      ) : null}
    </span>
  );
}

/**
 * An option renders as a *tint* of its own colour, never a saturated fill: a
 * grid of filled chips reads as decoration, and the colour stops carrying
 * information. `color-mix` rather than an appended hex alpha — an option colour
 * may be any CSS colour, and `#0a0` + "22" is not a colour at all.
 */
function OptionPill({ token }: { token: CrmValueToken }) {
  return (
    <span
      className="inline-flex max-w-full items-center rounded-badge bg-foreground/[0.06] px-1.5 py-0.5 text-xs font-medium text-content-secondary"
      style={
        token.color
          ? {
              backgroundColor: `color-mix(in srgb, ${token.color} 14%, transparent)`,
              color: token.color,
            }
          : undefined
      }
    >
      <span className="min-w-0 truncate">{token.label}</span>
    </span>
  );
}

/** A value that is a destination: underlined, with a decoration soft enough
 *  that a column of them does not read as a stack of rules. */
function LinkValue({
  text,
  href,
  onCopy,
}: {
  text: string;
  href?: string;
  onCopy?: () => void;
}) {
  const underline =
    "min-w-0 truncate underline decoration-content-ghost underline-offset-[0.14em] hover:decoration-content-secondary";
  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-1">
      {href ? (
        <a
          href={href}
          // A `mailto:` opened in a new tab leaves an empty one behind.
          {...(href.startsWith("http")
            ? { target: "_blank", rel: "noreferrer" }
            : {})}
          className={underline}
          onClick={(event) => event.stopPropagation()}
        >
          {text}
        </a>
      ) : (
        <span className={underline}>{text}</span>
      )}
      {onCopy ? (
        <button
          type="button"
          className="shrink-0 cursor-pointer text-content-ghost opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover/row:opacity-100"
          onClick={(event) => {
            event.stopPropagation();
            onCopy();
          }}
        >
          <IconCopy className="size-3.5" />
        </button>
      ) : null}
    </span>
  );
}

function StatusPill({
  attribute,
  value,
  overrun,
}: {
  attribute: CrmGridAttribute;
  value: CrmCellValue;
  overrun: number | null;
}) {
  const t = useT();
  const token = valueTokens(attribute, value)[0];
  // A status whose option was deleted still shows its stored value: "—" would
  // claim the record has no stage at all.
  if (!token) return <span className="text-content-ghost">{EMPTY}</span>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <OptionPill token={token} />
      {overrun !== null ? (
        <IconClockExclamation
          className="size-3.5 shrink-0 text-amber-600 dark:text-amber-500"
          aria-label={t("grid.slaOverrun", { days: overrun })}
        />
      ) : null}
    </span>
  );
}

export function CellDisplay({
  attribute,
  value,
  since,
  now,
}: {
  attribute: CrmGridAttribute;
  value: CrmCellValue;
  since?: string;
  now?: Date;
}) {
  const t = useT();
  const type = attribute.attributeType;

  if (type === "checkbox") {
    return (
      <Checkbox
        checked={value === true}
        disabled
        aria-label={attribute.label}
        className="pointer-events-none"
      />
    );
  }
  if (type === "rating") return <AttributeRating value={value} />;
  if (type === "status") {
    return (
      <StatusPill
        attribute={attribute}
        value={value}
        overrun={statusOverrunDays({
          attribute,
          value,
          since,
          ...(now ? { now } : {}),
        })}
      />
    );
  }
  if (type === "select") {
    const tokens = valueTokens(attribute, value);
    if (!tokens.length) {
      return <span className="text-content-ghost">{EMPTY}</span>;
    }
    return (
      <span className="flex items-center gap-1 overflow-hidden">
        {tokens.map((token, index) => (
          <OptionPill key={`${token.label}:${index}`} token={token} />
        ))}
      </span>
    );
  }
  if (type === "email-address" || type === "domain") {
    const values = Array.isArray(value) ? value : value === null ? [] : [value];
    if (!values.length) {
      return <span className="text-content-ghost">{EMPTY}</span>;
    }
    return (
      <span className="flex items-center gap-2 overflow-hidden">
        {values.map((entry) => {
          const text = String(entry);
          return (
            <LinkValue
              key={text}
              text={text}
              onCopy={() => copyToClipboard(text, t)}
              href={
                type === "domain"
                  ? text.startsWith("http")
                    ? text
                    : `https://${text}`
                  : `mailto:${text}`
              }
            />
          );
        })}
      </span>
    );
  }
  if (type === "record-reference" || type === "actor-reference") {
    const text = formatCell(attribute, value);
    if (!text) return <span className="text-content-ghost">{EMPTY}</span>;
    return (
      <Chip
        avatar={
          <RecordAvatar
            name={text}
            // A reference carries no object type, so only an actor — always a
            // person — can claim the round shape.
            shape={type === "actor-reference" ? "person" : "company"}
            className="size-4 text-[9px]"
          />
        }
      >
        {text}
      </Chip>
    );
  }

  const text = formatCell(attribute, value);
  if (!text) return <span className="text-content-ghost">{EMPTY}</span>;
  return <span className="block min-w-0 truncate">{text}</span>;
}

// ---------------------------------------------------------------------------
// Editors
// ---------------------------------------------------------------------------

const INPUT_CLASS =
  "h-full w-full border-0 bg-transparent px-3 text-sm outline-none ring-0 placeholder:text-content-ghost";

function useAutoFocus<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    ref.current?.focus();
    if (ref.current instanceof HTMLInputElement) ref.current.select();
  }, []);
  return ref;
}

function OptionPicker({
  attribute,
  value,
  onPick,
}: {
  attribute: CrmGridAttribute;
  value: CrmCellValue;
  onPick: (value: CrmCellValue) => void;
}) {
  const t = useT();
  const selected = new Set(
    (Array.isArray(value) ? value : value === null ? [] : [value]).map(String),
  );
  const options = activeOptions(attribute);
  if (!options.length) {
    return (
      <p className="w-56 px-3 py-2 text-xs text-muted-foreground">
        {t("grid.noOptions")}
      </p>
    );
  }
  function toggle(optionValue: string) {
    if (!attribute.multi) {
      onPick(selected.has(optionValue) ? null : optionValue);
      return;
    }
    const next = new Set(selected);
    if (next.has(optionValue)) next.delete(optionValue);
    else next.add(optionValue);
    onPick(next.size ? [...next] : null);
  }
  return (
    <div className="max-h-64 w-56 overflow-y-auto py-1">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-muted"
          onClick={() => toggle(option.value)}
        >
          <span
            className={cn(
              "size-3 shrink-0 rounded-full",
              // An uncolored option is a ring, not a grey dot: a filled grey
              // reads as "colored grey" next to real option colours.
              option.color ? "" : "ring-1 ring-inset ring-hairline",
            )}
            style={option.color ? { backgroundColor: option.color } : undefined}
          />
          <span className="flex-1 truncate">{option.title}</span>
          {selected.has(option.value) ? (
            <IconCheck className="size-3.5 shrink-0" />
          ) : null}
        </button>
      ))}
    </div>
  );
}

/**
 * The editor for one cell. `seed` is the character that started the edit, so
 * typing over a cell replaces its value the way a spreadsheet does.
 */
export function CellEditor({
  attribute,
  value,
  seed,
  onCommit,
  onCancel,
}: {
  attribute: CrmGridAttribute;
  value: CrmCellValue;
  seed?: string;
  onCommit: (
    raw: string | CrmCellValue,
    isRawText: boolean,
    direction?: GridDirection,
  ) => void;
  onCancel: () => void;
}) {
  const spec = cellSpecFor(attribute);
  // The raw value, never the formatted one: a currency cell seeded with
  // "$1,200.00" parses back as not-a-number the moment the user presses Enter.
  const [text, setText] = useState(() =>
    seed !== undefined ? seed : attributeInputValue(attribute, value),
  );
  const inputRef = useAutoFocus<HTMLInputElement>();
  // Escape and Enter both remove the input from the tree; without this the
  // blur that follows would commit a value the user just cancelled.
  const handled = useRef(false);

  if (spec.editor === "checkbox") {
    return (
      <span className="flex h-full items-start justify-center pt-2">
        <Checkbox
          autoFocus
          checked={value === true}
          onCheckedChange={(next) => onCommit(next === true, false)}
          aria-label={attribute.label}
        />
      </span>
    );
  }

  if (spec.editor === "rating") {
    const current = typeof value === "number" ? value : 0;
    return (
      <span className="flex h-full items-start px-3 pt-2">
        <span className="flex items-center gap-0.5 rounded-lg px-1.5 py-0.5 ring-1 ring-inset ring-transparent transition-[box-shadow] duration-[var(--motion-comfortable)] hover:ring-hairline">
          {Array.from({ length: RATING_MAX }, (_, index) => index + 1).map(
            (step) => (
              <button
                key={step}
                type="button"
                className="cursor-pointer"
                onClick={() => onCommit(step === current ? null : step, false)}
              >
                {step <= current ? (
                  <IconStarFilled className="size-3.5 text-amber-500" />
                ) : (
                  <IconStar className="size-3.5 text-content-ghost hover:text-amber-500" />
                )}
              </button>
            ),
          )}
        </span>
      </span>
    );
  }

  if (spec.editor === "options") {
    return (
      <Popover
        defaultOpen
        onOpenChange={(open) => {
          if (!open) onCancel();
        }}
      >
        <PopoverTrigger asChild>
          <span className="flex h-full items-start px-3 pt-2 text-sm">
            <CellDisplay attribute={attribute} value={value} />
          </span>
        </PopoverTrigger>
        <PopoverContent align="start" className="p-0">
          <OptionPicker
            attribute={attribute}
            value={value}
            onPick={(next) => onCommit(next, false)}
          />
        </PopoverContent>
      </Popover>
    );
  }

  if (spec.editor === "reference") {
    return (
      <Popover
        defaultOpen
        onOpenChange={(open) => {
          if (!open) onCancel();
        }}
      >
        <PopoverTrigger asChild>
          <span className="flex h-full items-start px-3 pt-2 text-sm">
            <CellDisplay attribute={attribute} value={value} />
          </span>
        </PopoverTrigger>
        <PopoverContent align="start" className="p-0">
          <RecordReferencePicker
            label={attribute.label}
            kind={referenceSearchKind(attribute)}
            selected={referenceMembers(value)}
            onPick={(next) => onCommit(next, true)}
            onCancel={onCancel}
          />
        </PopoverContent>
      </Popover>
    );
  }

  const input = editorInputType(attribute);

  return (
    <input
      ref={inputRef}
      type={input.type}
      defaultValue={text}
      {...(input.inputMode ? { inputMode: input.inputMode } : {})}
      onChange={(event) => setText(event.target.value)}
      onKeyDown={(event) => {
        const intent = resolveGridKey(event, { editing: true });
        if (!intent) return;
        // The editor owns Enter/Tab/Escape while it is open; letting them reach
        // the grid would move the active cell and commit twice.
        event.preventDefault();
        event.stopPropagation();
        handled.current = true;
        if (intent.type === "cancel") {
          onCancel();
          return;
        }
        if (intent.type === "commit") {
          onCommit(
            event.currentTarget.value,
            true,
            intent.direction ?? undefined,
          );
        }
      }}
      onBlur={(event) => {
        if (handled.current) return;
        onCommit(event.target.value, true);
      }}
      aria-label={attribute.label}
      className={cn(INPUT_CLASS, spec.align === "right" && "text-right")}
    />
  );
}
