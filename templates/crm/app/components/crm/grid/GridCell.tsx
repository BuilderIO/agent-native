import { useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  IconAlertTriangle,
  IconCheck,
  IconClockExclamation,
  IconCopy,
  IconExternalLink,
  IconStar,
  IconStarFilled,
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

import {
  activeOptions,
  attributeInputValue,
  RATING_MAX,
  valueTokens,
} from "../shared/attribute-value";
import {
  AttributeOptionChip,
  AttributeRating,
} from "../shared/AttributeValueParts";
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

function Chip({
  children,
  onCopy,
  href,
}: {
  children: React.ReactNode;
  onCopy?: () => void;
  href?: string;
}) {
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-full border border-border/70 bg-muted/40 py-0.5 pl-1.5 pr-2 text-xs">
      <span className="truncate">{children}</span>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 text-muted-foreground hover:text-foreground"
          onClick={(event) => event.stopPropagation()}
        >
          <IconExternalLink className="size-3" />
        </a>
      ) : null}
      {onCopy ? (
        <button
          type="button"
          className="shrink-0 cursor-pointer text-muted-foreground hover:text-foreground"
          onClick={(event) => {
            event.stopPropagation();
            onCopy();
          }}
        >
          <IconCopy className="size-3" />
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
  if (!token) return <span className="text-muted-foreground">{EMPTY}</span>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <AttributeOptionChip token={token} />
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
      return <span className="text-muted-foreground">{EMPTY}</span>;
    }
    return (
      <span className="flex flex-wrap items-center gap-1">
        {tokens.map((token, index) => (
          <AttributeOptionChip key={`${token.label}:${index}`} token={token} />
        ))}
      </span>
    );
  }
  if (type === "email-address" || type === "domain") {
    const values = Array.isArray(value) ? value : value === null ? [] : [value];
    if (!values.length) {
      return <span className="text-muted-foreground">{EMPTY}</span>;
    }
    return (
      <span className="flex flex-wrap items-center gap-1">
        {values.map((entry) => {
          const text = String(entry);
          return (
            <Chip
              key={text}
              onCopy={() => copyToClipboard(text, t)}
              {...(type === "domain"
                ? { href: text.startsWith("http") ? text : `https://${text}` }
                : {})}
            >
              {text}
            </Chip>
          );
        })}
      </span>
    );
  }
  if (type === "record-reference" || type === "actor-reference") {
    const text = formatCell(attribute, value);
    if (!text) return <span className="text-muted-foreground">{EMPTY}</span>;
    return <Chip>{text}</Chip>;
  }

  const text = formatCell(attribute, value);
  if (!text) return <span className="text-muted-foreground">{EMPTY}</span>;
  return <span className="block truncate">{text}</span>;
}

// ---------------------------------------------------------------------------
// Editors
// ---------------------------------------------------------------------------

const INPUT_CLASS =
  "h-full w-full border-0 bg-transparent px-2 text-sm outline-none ring-0 placeholder:text-muted-foreground/60";

function useAutoFocus<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    ref.current?.focus();
    if (ref.current instanceof HTMLInputElement) ref.current.select();
  }, []);
  return ref;
}

function ReferencePicker({
  attribute,
  onPick,
  onCancel,
}: {
  attribute: CrmGridAttribute;
  onPick: (value: string) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const [search, setSearch] = useState("");
  const inputRef = useAutoFocus<HTMLInputElement>();
  const results = useActionQuery<{
    records?: Array<{ id: string; displayName: string; subtitle?: string }>;
  }>(
    "list-crm-records" as never,
    { query: search.trim() || undefined, limit: 8 } as never,
    { enabled: search.trim().length > 1 } as never,
  );
  const records = results.data?.records ?? [];
  return (
    <div className="w-64">
      <input
        ref={inputRef}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") onCancel();
        }}
        placeholder={t("grid.searchRecords")}
        className="w-full border-b border-border/70 bg-transparent px-3 py-2 text-sm outline-none"
      />
      <div className="max-h-56 overflow-y-auto py-1">
        {search.trim().length <= 1 ? (
          <p className="px-3 py-2 text-xs text-muted-foreground">
            {t("grid.searchToLink")}
          </p>
        ) : results.isError ? (
          <p className="px-3 py-2 text-xs text-destructive">
            {t("grid.searchFailed")}
          </p>
        ) : records.length === 0 ? (
          <p className="px-3 py-2 text-xs text-muted-foreground">
            {results.isLoading ? t("grid.searching") : t("grid.noMatches")}
          </p>
        ) : (
          records.map((record) => (
            <button
              key={record.id}
              type="button"
              className="flex w-full cursor-pointer flex-col items-start px-3 py-1.5 text-left text-sm hover:bg-muted"
              onClick={() => onPick(record.displayName)}
            >
              <span className="truncate font-medium">{record.displayName}</span>
              {record.subtitle ? (
                <span className="truncate text-xs text-muted-foreground">
                  {record.subtitle}
                </span>
              ) : null}
            </button>
          ))
        )}
      </div>
      <p className="border-t border-border/60 px-3 py-1.5 text-[11px] text-muted-foreground">
        {t("grid.referenceHint", { attribute: attribute.label })}
      </p>
    </div>
  );
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
            className="size-2 shrink-0 rounded-full"
            style={{
              backgroundColor: option.color ?? "var(--muted-foreground)",
            }}
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
      <span className="flex h-full items-center justify-center">
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
      <span className="flex h-full items-center gap-0.5 px-2">
        {Array.from({ length: RATING_MAX }, (_, index) => index + 1).map(
          (step) => (
            <button
              key={step}
              type="button"
              className="cursor-pointer"
              onClick={() => onCommit(step === current ? null : step, false)}
            >
              {step <= current ? (
                <IconStarFilled className="size-4 text-amber-500" />
              ) : (
                <IconStar className="size-4 text-muted-foreground/50 hover:text-amber-500" />
              )}
            </button>
          ),
        )}
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
          <span className="flex h-full items-center px-2 text-sm">
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
          <span className="flex h-full items-center px-2 text-sm">
            <CellDisplay attribute={attribute} value={value} />
          </span>
        </PopoverTrigger>
        <PopoverContent align="start" className="p-0">
          <ReferencePicker
            attribute={attribute}
            onPick={(next) => onCommit(next, true)}
            onCancel={onCancel}
          />
        </PopoverContent>
      </Popover>
    );
  }

  // The grid overrides the registry's `number` input type: spinner arrows in a
  // 34px cell steal the scroll wheel while the sheet is being scrolled.
  const inputType = spec.inputType === "number" ? "text" : spec.inputType;

  return (
    <input
      ref={inputRef}
      type={inputType}
      defaultValue={text}
      inputMode={spec.editor === "number" ? "decimal" : undefined}
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
