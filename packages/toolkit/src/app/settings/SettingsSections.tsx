import { useT } from "@agent-native/core/client/i18n";
import { useEffect, useId, useState, type FormEvent } from "react";

import { Dialog } from "../../design-system/components.js";
import { useDesignSystemComponent } from "../../design-system/context.js";
import { Button } from "../../ui/button.js";
import { Checkbox } from "../../ui/checkbox.js";
import { Input } from "../../ui/input.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../ui/select.js";
import { Skeleton } from "../../ui/skeleton.js";
import { Switch } from "../../ui/switch.js";
import { Textarea } from "../../ui/textarea.js";
import type {
  Binding,
  Operation,
  CollectionFieldValue,
  CollectionRow,
  RowAction,
  SettingsRowDefinition,
  SettingsRowId,
  SettingsSection,
} from "./schema.js";
import { resolveSettingsSummary } from "./settings-summary.js";
import { SettingsGroup, SettingsRow } from "./SettingsRow.js";

export interface SettingsSectionsProps {
  sections: readonly SettingsSection[];
  pageId?: string;
}

function rowTags(id: SettingsRowId, entityKey?: string) {
  return {
    "data-rid": id,
    "data-part": "settings.row",
    "data-rid-key": entityKey,
  };
}

function unavailable(row: { condition?: { disabledReason?: string } }) {
  return row.condition?.disabledReason !== undefined;
}

function useWriteStatus() {
  const t = useT();
  const [failed, setFailed] = useState(false);
  async function run<Value>(operation: Operation<Value>, value: Value) {
    setFailed(false);
    try {
      await operation.run(value);
      return true;
    } catch {
      setFailed(true);
      return false;
    }
  }
  return {
    run,
    message: failed ? t("agentChat.common.saveFailed") : undefined,
  };
}

function ActionControl({
  id,
  action,
  entityKey,
}: {
  id: SettingsRowId;
  action: RowAction;
  entityKey?: string;
}) {
  const [open, setOpen] = useState(false);
  const status = useWriteStatus();
  const disabled = unavailable(action);
  const trigger = action.trigger;
  if (action.condition?.visible === false) return null;
  if (trigger.kind === "navigate" && !disabled) {
    return (
      <a {...rowTags(id, entityKey)} href={trigger.href}>
        {action.label}
      </a>
    );
  }
  const Body = trigger.kind === "dialog" ? trigger.body : null;
  return (
    <>
      <Button
        {...rowTags(id, entityKey)}
        type="button"
        size="sm"
        variant={action.intent === "danger" ? "destructive" : "outline"}
        disabled={disabled}
        aria-haspopup={Body ? "dialog" : undefined}
        onClick={() => {
          if (trigger.kind === "dialog") setOpen(true);
          if (trigger.kind === "invoke")
            void status.run(trigger.operation, undefined);
        }}
      >
        {action.label}
      </Button>
      {status.message ? <p role="alert">{status.message}</p> : null}
      {Body && trigger.kind === "dialog" ? (
        <Dialog open={open} onOpenChange={setOpen} title={trigger.title}>
          <Body close={() => setOpen(false)} />
        </Dialog>
      ) : null}
    </>
  );
}

function TextControl({
  row,
}: {
  row: Extract<SettingsRowDefinition, { kind: "text" | "textarea" | "time" }>;
}) {
  const { binding } = row;
  const [draft, setDraft] = useState<string>();
  const status = useWriteStatus();
  const read = binding.read;
  if (read.status !== "ready") return <ReadStatus read={read} />;
  const value = draft ?? read.value;
  const disabled = unavailable(row) || binding.pending || !binding.write;
  const write = binding.write;
  const commit = () => {
    if (!disabled && write && value !== read.value) {
      void status.run(write, value).then((saved) => {
        if (saved) setDraft(undefined);
      });
    }
  };
  const props = {
    ...rowTags(row.id),
    "aria-label": row.label,
    value,
    placeholder: row.placeholder,
    maxLength: row.maxLength,
    disabled,
    onChange: (
      event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
    ) => {
      const next = event.currentTarget.value;
      if (binding.commit === "change") {
        if (write) void status.run(write, next);
      } else {
        setDraft(next);
      }
    },
    onBlur: () => {
      if (binding.commit === "blur") commit();
    },
  };
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (binding.commit !== "change") commit();
      }}
      className="flex items-start gap-2"
    >
      {row.kind === "textarea" ? (
        <Textarea {...props} />
      ) : (
        <Input {...props} type={row.kind === "time" ? "time" : "text"} />
      )}
      {status.message ? <p role="alert">{status.message}</p> : null}
      {binding.commit === "explicit" && binding.saveLabel ? (
        <Button
          type="submit"
          size="sm"
          disabled={disabled || draft === undefined}
        >
          {binding.saveLabel}
        </Button>
      ) : null}
    </form>
  );
}

function ReadStatus({ read }: { read: Binding<unknown>["read"] }) {
  if (read.status === "loading") return <Skeleton className="h-8 w-24" />;
  if (read.status === "error") return <p role="alert">{read.message}</p>;
  return null;
}

function ImagePreview({ file }: { file: File }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  return url ? (
    <img src={url} alt="" className="size-8 rounded object-contain" />
  ) : null;
}

function CollectionAddForm({
  id,
  add,
}: {
  id: SettingsRowId;
  add: Extract<NonNullable<CollectionRow["add"]>, { kind: "fields" }>;
}) {
  const [values, setValues] = useState<Record<string, CollectionFieldValue>>(
    {},
  );
  const [submitting, setSubmitting] = useState(false);
  const status = useWriteStatus();
  const disabled = submitting || add.pending;
  const update = (field: string, value: CollectionFieldValue | undefined) => {
    setValues((previous) => {
      const next = { ...previous };
      if (value === undefined) delete next[field];
      else next[field] = value;
      return next;
    });
  };
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled) return;
    const form = event.currentTarget;
    setSubmitting(true);
    try {
      if (await status.run(add.submit, values)) {
        setValues({});
        form.reset();
      }
    } finally {
      setSubmitting(false);
    }
  }
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(event) => void submit(event)}
    >
      {add.fields.map((field) => {
        const tags = rowTags(`${id}.add.${field.id}`);
        const value = values[field.id];
        if (field.kind === "image") {
          return (
            <div key={field.id} className="flex items-center gap-2">
              <Input
                {...tags}
                type="file"
                aria-label={field.label}
                accept={field.accept.join(",")}
                required={field.required}
                disabled={disabled}
                onChange={(event) =>
                  update(field.id, event.currentTarget.files?.[0])
                }
              />
              {value instanceof File ? <ImagePreview file={value} /> : null}
            </div>
          );
        }
        if (field.kind === "checkbox") {
          return (
            <Checkbox
              key={field.id}
              {...tags}
              aria-label={field.label}
              checked={value === true}
              disabled={disabled}
              onCheckedChange={(checked) => update(field.id, checked === true)}
            />
          );
        }
        if (field.kind === "select") {
          return (
            <Select
              key={field.id}
              value={typeof value === "string" ? value : ""}
              disabled={disabled}
              required={field.required}
              onValueChange={(selected) => update(field.id, selected)}
            >
              <SelectTrigger {...tags} aria-label={field.label}>
                <SelectValue placeholder={field.label} />
              </SelectTrigger>
              <SelectContent>
                {field.options.map((option) => (
                  <SelectItem
                    key={option.value}
                    value={option.value}
                    disabled={option.disabledReason !== undefined}
                  >
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          );
        }
        return (
          <Input
            key={field.id}
            {...tags}
            aria-label={field.label}
            required={field.required}
            disabled={disabled}
            value={typeof value === "string" ? value : ""}
            onChange={(event) => update(field.id, event.currentTarget.value)}
          />
        );
      })}
      <Button
        {...rowTags(`${id}.add.submit`)}
        type="submit"
        disabled={disabled}
        size="sm"
      >
        {add.submitLabel}
      </Button>
      {add.error || status.message ? (
        <p role="alert">{add.error ?? status.message}</p>
      ) : null}
    </form>
  );
}

function Collection({ row }: { row: CollectionRow }) {
  const [adding, setAdding] = useState(false);
  return (
    <div className="space-y-3" {...rowTags(row.id)}>
      <div className="flex flex-wrap items-center gap-2">
        {row.search ? (
          <Input
            {...rowTags(`${row.id}.search`)}
            aria-label={row.search.label}
            value={row.search.value}
            onChange={(event) => row.search?.set(event.currentTarget.value)}
          />
        ) : null}
        {row.add?.kind === "trigger" ? (
          <ActionControl id={`${row.id}.add`} action={row.add.action} />
        ) : null}
        {row.add?.kind === "fields" ? (
          <Button
            {...rowTags(`${row.id}.add`)}
            type="button"
            size="sm"
            variant="outline"
            aria-expanded={adding}
            onClick={() => setAdding(!adding)}
          >
            {row.add.label}
          </Button>
        ) : null}
      </div>
      {adding && row.add?.kind === "fields" ? (
        <CollectionAddForm id={row.id} add={row.add} />
      ) : null}
      {row.items.status !== "ready" ? (
        <ReadStatus read={row.items} />
      ) : row.items.value.length === 0 ? (
        <p>
          {row.search?.value && row.noMatchesLabel
            ? row.noMatchesLabel
            : row.emptyLabel}
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {row.items.value.map((item) => (
            <li
              key={item.key}
              {...rowTags(`${row.id}.item`, item.key)}
              className="flex items-center justify-between gap-3 py-2"
            >
              <div className="flex items-center gap-2">
                {item.image ? (
                  <img
                    src={item.image.src}
                    alt={item.image.alt}
                    className="size-5 object-contain"
                  />
                ) : null}
                <div>
                  <span>{item.title}</span>
                  {item.description ? <p>{item.description}</p> : null}
                </div>
                {item.badges?.map((badge) => (
                  <span key={badge} className="rounded bg-muted px-1.5 text-xs">
                    {badge}
                  </span>
                ))}
              </div>
              {item.actions.map((action) => (
                <ActionControl
                  key={action.id}
                  id={`${row.id}.item.${action.id}`}
                  entityKey={item.key}
                  action={action}
                />
              ))}
            </li>
          ))}
        </ul>
      )}
      {row.paging?.previous && row.previousLabel ? (
        <Button
          {...rowTags(`${row.id}.previous`)}
          type="button"
          onClick={row.paging.previous}
        >
          {row.previousLabel}
        </Button>
      ) : null}
      {row.paging?.next && row.nextLabel ? (
        <Button
          {...rowTags(`${row.id}.next`)}
          type="button"
          onClick={row.paging.next}
        >
          {row.nextLabel}
        </Button>
      ) : null}
    </div>
  );
}

function Disclosure({
  row,
  children,
}: {
  row: Extract<
    SettingsRowDefinition,
    { kind: "disclosure" | "checkbox-group" }
  >;
  children: React.ReactNode;
}) {
  const contentId = useId();
  const state = row.kind === "disclosure" ? row : row.disclosure;
  if (!state) return children;
  const summary =
    state.summary && (state.summary.when === "always" || !state.expanded)
      ? resolveSettingsSummary(state.summary, row)
      : undefined;
  return (
    <div className="space-y-2">
      <Button
        {...rowTags(row.id)}
        type="button"
        variant="ghost"
        size="sm"
        aria-expanded={state.expanded}
        aria-controls={contentId}
        disabled={unavailable(row)}
        onClick={() => state.setExpanded(!state.expanded)}
      >
        {row.label}
      </Button>
      {summary ? (
        <span className="ms-2 text-xs text-muted-foreground">{summary}</span>
      ) : null}
      <div id={contentId} hidden={!state.expanded}>
        {state.expanded ? children : null}
      </div>
    </div>
  );
}

function Control({ row }: { row: SettingsRowDefinition }) {
  const status = useWriteStatus();
  return (
    <>
      <RowControl row={row} write={status.run} />
      {status.message ? <p role="alert">{status.message}</p> : null}
    </>
  );
}

function RowControl({
  row,
  write,
}: {
  row: SettingsRowDefinition;
  write: ReturnType<typeof useWriteStatus>["run"];
}) {
  if (row.kind === "action")
    return <ActionControl id={row.id} action={row.action} />;
  if (row.kind === "link")
    return (
      <a
        {...rowTags(row.id)}
        href={row.href}
        target={row.external ? "_blank" : undefined}
        rel={row.external ? "noreferrer" : undefined}
      >
        {row.label}
      </a>
    );
  if (row.kind === "info")
    return (
      <span {...rowTags(row.id)}>
        {row.value}
        {row.copyLabel ? (
          <Button
            {...rowTags(`${row.id}.copy`)}
            type="button"
            size="sm"
            onClick={() =>
              void write(
                {
                  actionName: "copy",
                  run: () => navigator.clipboard.writeText(row.value),
                },
                undefined,
              )
            }
          >
            {row.copyLabel}
          </Button>
        ) : null}
      </span>
    );
  if (row.kind === "custom")
    return (
      <div {...rowTags(row.id)}>
        <row.component />
      </div>
    );
  if (row.kind === "collection") return <Collection row={row} />;
  if (row.kind === "disclosure")
    return (
      <Disclosure row={row}>
        <Rows rows={row.rows} />
      </Disclosure>
    );
  if (row.kind === "text" || row.kind === "textarea" || row.kind === "time")
    return <TextControl row={row} />;

  const { binding } = row;
  function run<Value>(value: Value, operation: Operation<Value> | undefined) {
    if (operation) return write(operation, value);
  }
  const read = binding.read;
  if (read.status !== "ready") return <ReadStatus read={read} />;
  const disabled = unavailable(row) || binding.pending || !binding.write;
  if (row.kind === "checkbox" || row.kind === "toggle") {
    const props = {
      ...rowTags(row.id),
      "aria-label": row.label,
      checked: row.binding.read.status === "ready" && row.binding.read.value,
      disabled,
    };
    return row.kind === "toggle" ? (
      <Switch
        {...props}
        onCheckedChange={(checked) => void run(checked, row.binding.write)}
      />
    ) : (
      <Checkbox
        {...props}
        onCheckedChange={(checked) =>
          void run(checked === true, row.binding.write)
        }
      />
    );
  }
  if (row.kind === "checkbox-group" || row.kind === "multi-select") {
    if (row.binding.read.status !== "ready") return null;
    const values = row.binding.read.value;
    const options = (
      <fieldset aria-label={row.label} className="grid gap-2 sm:grid-cols-2">
        {row.options.map((option) => (
          <label key={option.value} className="flex items-center gap-2">
            <Checkbox
              {...rowTags(`${row.id}.${option.value}`)}
              checked={values.includes(option.value)}
              disabled={disabled || option.disabledReason !== undefined}
              onCheckedChange={(checked) =>
                void run(
                  checked === true
                    ? [...values, option.value]
                    : values.filter((value) => value !== option.value),
                  row.binding.write,
                )
              }
            />
            {option.label}
          </label>
        ))}
      </fieldset>
    );
    return row.kind === "checkbox-group" && row.disclosure ? (
      <Disclosure row={row}>{options}</Disclosure>
    ) : (
      <div {...rowTags(row.id)}>{options}</div>
    );
  }
  if (row.kind === "number") {
    if (row.binding.read.status !== "ready") return null;
    return (
      <Input
        {...rowTags(row.id)}
        type="number"
        aria-label={row.label}
        min={row.min}
        max={row.max}
        step={row.step}
        disabled={disabled}
        value={row.binding.read.value ?? ""}
        onChange={(event) => {
          const next = event.currentTarget.value;
          const numeric = event.currentTarget.valueAsNumber;
          if (!next || Number.isFinite(numeric))
            void run(next ? numeric : null, row.binding.write);
        }}
      />
    );
  }
  if (
    row.kind === "select" ||
    row.kind === "radio" ||
    row.kind === "segmented"
  ) {
    if (row.binding.read.status !== "ready") return null;
    const value = row.binding.read.value;
    if (row.kind !== "select")
      return (
        <fieldset
          {...rowTags(row.id)}
          aria-label={row.label}
          className="flex flex-wrap gap-3"
        >
          {row.options.map((option) => (
            <label key={option.value} className="flex items-center gap-2">
              <input
                {...rowTags(`${row.id}.${option.value}`)}
                type="radio"
                name={row.id}
                checked={value === option.value}
                disabled={disabled || option.disabledReason !== undefined}
                onChange={() => void run(option.value, row.binding.write)}
              />
              {option.label}
            </label>
          ))}
        </fieldset>
      );
    const adornment = row.options.find(
      (option) => option.value === value,
    )?.adornment;
    return (
      <div className="flex items-center gap-2">
        {adornment?.kind === "dot" ? (
          <span
            aria-hidden="true"
            className="size-2 rounded-full bg-muted-foreground"
          />
        ) : null}
        {adornment?.kind === "badge" ? (
          <span
            aria-hidden="true"
            className="rounded-full bg-muted px-1.5 text-xs text-muted-foreground"
          >
            {adornment.text}
          </span>
        ) : null}
        <Select
          value={value ?? ""}
          disabled={disabled}
          onValueChange={(next) => void run(next, row.binding.write)}
        >
          <SelectTrigger {...rowTags(row.id)} aria-label={row.label}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {row.options.map((option) => (
              <SelectItem
                key={option.value}
                value={option.value}
                disabled={option.disabledReason !== undefined}
              >
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  }
  throw new Error("Unsupported Settings row");
}

function Rows({ rows }: { rows: readonly SettingsRowDefinition[] }) {
  return rows
    .filter((row) => row.condition?.visible !== false)
    .map((row) => (
      <SettingsRow
        key={row.id}
        id={row.id}
        schemaRow={row.kind === "custom" ? undefined : row.id}
        label={row.label}
        description={row.description}
        control={<Control row={row} />}
      >
        {row.condition?.disabledReason ||
        ("binding" in row && row.binding.error) ? (
          <>
            {row.condition?.disabledReason ? (
              <p>{row.condition.disabledReason}</p>
            ) : null}
            {"binding" in row && row.binding.error ? (
              <p role="alert">{row.binding.error}</p>
            ) : null}
          </>
        ) : null}
      </SettingsRow>
    ));
}

export function HouseSettingsPage({ sections }: SettingsSectionsProps) {
  return (
    <div data-part="settings.page" className="space-y-6">
      {sections.map((section) => (
        <SettingsGroup
          key={section.id}
          id={section.id}
          {...(section.label ? { title: section.label } : {})}
        >
          <Rows rows={section.rows} />
        </SettingsGroup>
      ))}
    </div>
  );
}

export function SettingsSections(props: SettingsSectionsProps) {
  const Page = useDesignSystemComponent("SettingsPage") ?? HouseSettingsPage;
  return <Page {...props} />;
}
