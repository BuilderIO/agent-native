/**
 * The record panel's display and inline editors.
 *
 * What a value says, which option it resolves to, and how typed input parses
 * back all come from `../shared/attribute-value`, the one registry the
 * spreadsheet grid reads too. This file owns only the panel's own affordances:
 * a labelled full-width row, a shadcn `Select` instead of the grid's popover,
 * and commit-on-blur instead of the grid's commit-and-advance.
 */

import { useT } from "@agent-native/core/client/i18n";
import { IconAlertTriangle, IconPlus, IconX } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";

import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

import type {
  CrmAttributeDefinition,
  CrmValue,
} from "../../../../shared/crm-contract";
import {
  activeOptions,
  editorDraftFor,
  editorInputType,
  referenceMembers,
  referenceSearchKind,
  toggleReferenceValue,
  valueSpecFor,
} from "../shared/attribute-value";
import {
  AttributeOptionChip,
  AttributeRating,
} from "../shared/AttributeValueParts";
import { RecordReferencePicker } from "../shared/RecordReferencePicker";
import { overlayProps } from "../shared/ui-tokens";
import {
  fieldEditability,
  fieldInputValue,
  formatFieldValue,
  parseFieldInput,
  type FieldLockReason,
} from "./record-data";

/** Sentinel for "clear this option" — shadcn `SelectItem` rejects an empty value. */
const CLEAR_OPTION = "__crm_clear__";

type EditableAttribute = Pick<
  CrmAttributeDefinition,
  | "apiSlug"
  | "label"
  | "attributeType"
  | "multi"
  | "options"
  | "config"
  | "archived"
  | "storagePolicy"
  | "updateable"
  | "required"
>;

export function FieldValueDisplay({
  attribute,
  value,
}: {
  attribute: EditableAttribute;
  value: CrmValue | undefined;
}) {
  const t = useT();
  const display = formatFieldValue(attribute, value);
  if (display.kind === "empty")
    return (
      <span className="text-muted-foreground">{t("record.fieldEmpty")}</span>
    );
  if (attribute.attributeType === "rating")
    return <AttributeRating value={value ?? null} />;
  if (display.kind === "boolean")
    return <span>{display.value ? t("record.yes") : t("record.no")}</span>;
  if (display.kind === "tokens")
    return (
      <span className="flex flex-wrap gap-1">
        {display.tokens.map((token, index) => (
          <AttributeOptionChip key={`${token.label}:${index}`} token={token} />
        ))}
      </span>
    );
  if (display.kind === "structured")
    return (
      <code className="break-all text-xs text-muted-foreground">
        {display.text}
      </code>
    );
  return <span className="break-words">{display.text}</span>;
}

const LOCK_KEYS: Record<FieldLockReason, string> = {
  archived: "record.lockArchived",
  "read-only": "record.lockReadOnly",
  redacted: "record.lockRedacted",
  "provider-owned": "record.lockProviderOwned",
  derived: "record.lockDerived",
  "unsupported-type": "record.lockUnsupportedType",
};

export function FieldLockNote({ reason }: { reason: FieldLockReason }) {
  const t = useT();
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <IconAlertTriangle className="size-3.5" />
      {t(LOCK_KEYS[reason])}
    </span>
  );
}

/**
 * One editable value. Options and checkboxes commit on change; free text
 * commits on blur or Enter and reverts on Escape. `onCommit` is expected to be
 * optimistic — nothing here blocks on the write.
 */
export function FieldEditor({
  attribute,
  value,
  onCommit,
  autoFocus = false,
  onDone,
}: {
  attribute: EditableAttribute;
  value: CrmValue | undefined;
  onCommit: (next: CrmValue) => void;
  autoFocus?: boolean;
  onDone?: () => void;
}) {
  const t = useT();
  const seed = fieldInputValue(attribute, value);
  const [state, setState] = useState(() => editorDraftFor(undefined, seed));
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Set the moment the input takes focus, cleared by the click that follows.
  // See `selectOnFocus` below.
  const selectedOnFocus = useRef(false);

  // Re-seeded during render, not from an effect: an effect re-seed lands after
  // the browser has already applied the keystroke it is about to overwrite.
  const current = editorDraftFor(state, seed);
  if (current !== state) setState(current);
  const draft = current.draft;

  useEffect(() => {
    if (!autoFocus) return;
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    // Select here as well as in `onFocus`, not instead of it. A programmatic
    // `focus()` fires no focus event while the document itself is unfocused
    // (a background tab, a devtools-driven run), so an `onFocus`-only select
    // silently leaves the caret at the end of the old value and the first
    // thing typed is appended to it.
    input.select();
  }, [autoFocus]);

  /**
   * Select the whole value whenever the field takes focus, so the next thing
   * typed *replaces* it.
   *
   * This hangs off focus rather than off `autoFocus` alone because
   * `FieldEditor` is also rendered as an always-live input (list entry rows),
   * where nothing ever mounts it focused: a caller that does not pass
   * `autoFocus` would otherwise get an editor that appends to the old value.
   * Selecting is the editor's own property, not something each caller has to
   * remember — that is how the same append bug came back twice.
   *
   * The `mouseUp` half matters: when focus came from a click, the browser
   * places the caret on mouse-up and would drop the selection made here.
   */
  const selectOnFocus = {
    onFocus: (event: React.FocusEvent<HTMLInputElement>) => {
      selectedOnFocus.current = true;
      event.currentTarget.select();
    },
    onMouseUp: (event: React.MouseEvent<HTMLInputElement>) => {
      if (!selectedOnFocus.current) return;
      selectedOnFocus.current = false;
      event.preventDefault();
    },
  };

  const input = editorInputType(attribute);

  /**
   * Commit what the control actually holds, and refuse when it cannot say.
   *
   * `validity.badInput` is the browser reporting "the user typed something I
   * cannot express" — a half-written date, a stray `e` in a number. In that
   * state `value` is the empty string, which `parse` reads as *cleared* and
   * would store as null. Committing it turns a typo into silent data loss, so
   * the editor says so and keeps the value the record already has.
   */
  function commitFromInput(node: HTMLInputElement) {
    selectedOnFocus.current = false;
    if (node.validity.badInput) {
      setError(
        input.type === "date" || input.type === "datetime-local"
          ? t("record.invalidDate")
          : t("record.invalidNumber"),
      );
      return;
    }
    commit(node.value);
  }

  function commit(raw: string | boolean) {
    const parsed = parseFieldInput(attribute, raw);
    if (!parsed.ok) {
      setError(
        parsed.code === "not-a-number"
          ? t("record.invalidNumber")
          : parsed.code === "not-a-date"
            ? t("record.invalidDate")
            : parsed.code === "unknown-option"
              ? t("record.unknownOption")
              : t("record.notEditable"),
      );
      return;
    }
    setError(null);
    onCommit(parsed.value);
    onDone?.();
  }

  /**
   * Commit a typed value the picker produced directly. It skips text parsing —
   * a reference display name may contain the comma a multi value splits on —
   * but not the editability gate, which is what keeps a doomed write off the
   * wire.
   */
  function commitValue(next: CrmValue) {
    if (!fieldEditability(attribute).editable) {
      setError(t("record.notEditable"));
      return;
    }
    setError(null);
    onCommit(next);
  }

  const spec = valueSpecFor(attribute);

  if (spec.control === "checkbox") {
    return (
      <Switch
        checked={value === true}
        aria-label={attribute.apiSlug}
        onCheckedChange={(next) => commit(next)}
      />
    );
  }

  const options = activeOptions(attribute);
  if (!attribute.multi && spec.control === "options") {
    return (
      <Select
        value={typeof value === "string" && value ? value : undefined}
        onValueChange={(next) => commit(next === CLEAR_OPTION ? "" : next)}
      >
        <SelectTrigger className="h-8" aria-label={attribute.apiSlug}>
          <SelectValue placeholder={t("record.fieldEmpty")} />
        </SelectTrigger>
        <SelectContent>
          {attribute.required ? null : (
            <SelectItem value={CLEAR_OPTION}>
              {t("record.clearValue")}
            </SelectItem>
          )}
          {options.map((option) => (
            <SelectItem key={option.id} value={option.value}>
              {option.title}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  if (spec.control === "reference") {
    return (
      <div className="grid gap-1">
        <ReferenceField
          attribute={attribute}
          value={value}
          autoFocus={autoFocus}
          onCommit={commitValue}
          onDone={onDone}
        />
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="grid gap-1">
      <Input
        ref={inputRef}
        className="h-8"
        type={input.type}
        {...(input.inputMode ? { inputMode: input.inputMode } : {})}
        value={draft}
        aria-label={attribute.apiSlug}
        placeholder={attribute.multi ? t("record.multiValueHint") : undefined}
        maxLength={4_000}
        {...selectOnFocus}
        onChange={(event) =>
          setState({ ...current, draft: event.target.value })
        }
        onBlur={(event) => commitFromInput(event.currentTarget)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commitFromInput(event.currentTarget);
          }
          if (event.key === "Escape") {
            event.preventDefault();
            setState(editorDraftFor(undefined, seed));
            setError(null);
            onDone?.();
          }
        }}
      />
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

/**
 * A link to another record: a searchable popover, and the committed value as
 * chips. `multi` toggles membership instead of replacing, and a chip carries
 * its own unlink control — the popover would otherwise be the only way to
 * remove one, which needs the user to search for a record they can already see.
 */
function ReferenceField({
  attribute,
  value,
  autoFocus,
  onCommit,
  onDone,
}: {
  attribute: EditableAttribute;
  value: CrmValue | undefined;
  /** The row was just activated, so open the search straight away rather than
   *  making the user click the value twice to get to a picker. */
  autoFocus: boolean;
  onCommit: (next: CrmValue) => void;
  onDone?: () => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(autoFocus);
  const members = referenceMembers(value);

  function pick(displayName: string) {
    onCommit(toggleReferenceValue(value, displayName, attribute.multi));
    if (!attribute.multi) {
      setOpen(false);
      onDone?.();
    }
  }

  // `toggleReferenceValue` is a *pick*: on a single reference it replaces, so
  // reusing it here would re-write the value the user is trying to remove.
  function unlink(member: string) {
    onCommit(
      attribute.multi ? toggleReferenceValue(value, member, true) : null,
    );
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) onDone?.();
      }}
    >
      <div className="flex flex-wrap items-center gap-1">
        {members.map((member) => (
          <span key={member} className="inline-flex items-center gap-0.5">
            <AttributeOptionChip token={{ label: member }} />
            <button
              type="button"
              className="cursor-pointer text-content-ghost hover:text-foreground"
              aria-label={t("record.clearValue")}
              onClick={() => unlink(member)}
            >
              <IconX className="size-3.5" />
            </button>
          </span>
        ))}
        <PopoverTrigger asChild>
          <button
            type="button"
            {...overlayProps({
              className:
                "cursor-pointer rounded-lg px-2 py-1 text-left text-sm",
            })}
            aria-label={attribute.apiSlug}
          >
            {members.length ? (
              <IconPlus className="size-3.5" />
            ) : (
              <span className="text-muted-foreground">
                {t("record.fieldEmpty")}
              </span>
            )}
          </button>
        </PopoverTrigger>
      </div>
      <PopoverContent align="start" className="p-0">
        <RecordReferencePicker
          label={attribute.label}
          kind={referenceSearchKind(attribute)}
          selected={members}
          onPick={pick}
          onCancel={() => setOpen(false)}
        />
      </PopoverContent>
    </Popover>
  );
}
