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
import { IconAlertTriangle } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";

import { Input } from "@/components/ui/input";
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
import { activeOptions, valueSpecFor } from "../shared/attribute-value";
import {
  AttributeOptionChip,
  AttributeRating,
} from "../shared/AttributeValueParts";
import {
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
  const [draft, setDraft] = useState(() => fieldInputValue(attribute, value));
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraft(fieldInputValue(attribute, value));
  }, [attribute, value]);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

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

  // A multi value is a comma-separated list, which no typed input accepts.
  const inputType = attribute.multi ? "text" : spec.inputType;

  return (
    <div className="grid gap-1">
      <Input
        ref={inputRef}
        className="h-8"
        type={inputType}
        value={draft}
        aria-label={attribute.apiSlug}
        placeholder={attribute.multi ? t("record.multiValueHint") : undefined}
        maxLength={4_000}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => commit(draft)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit(draft);
          }
          if (event.key === "Escape") {
            event.preventDefault();
            setDraft(fieldInputValue(attribute, value));
            setError(null);
            onDone?.();
          }
        }}
      />
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
