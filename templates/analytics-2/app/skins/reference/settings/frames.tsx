import type {
  SettingsCollectionAdd,
  SettingsCollectionItem,
  SettingsHints,
  SettingsRowAction,
  SettingsRowDefinition,
  SettingsSectionDefinition,
  SettingsSectionsProps,
} from "@agent-native/toolkit/app/settings";
import { Skeleton, Switch } from "@agent-native/toolkit/design-system";
import { IconDots } from "@tabler/icons-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useConfirmDialogBehavior } from "@/components/ui/useConfirmDialogBehavior";
import {
  HouseSettingsSections,
  SettingsGroup,
  isSettingsRowDisabled,
  isSettingsRowVisible,
  settingsTags,
  useSettingsAction,
  useSettingsCollectionAdd,
  useSettingsTextDraft,
  useSettingsWrite,
} from "@/skins/settings-rows";

import type { ReferenceSettingsFrame } from "../settings-sections";

type Row<Kind extends SettingsRowDefinition["kind"]> = Extract<
  SettingsRowDefinition,
  { kind: Kind }
>;

type ToggleRow = Extract<
  SettingsRowDefinition,
  { kind: "toggle" | "checkbox" }
>;

type TextRow = Extract<
  SettingsRowDefinition,
  { kind: "text" | "textarea" | "time" }
>;

type FieldsAdd = Extract<SettingsCollectionAdd, { kind: "fields" }>;

function hint(bag: SettingsHints | undefined, name: string) {
  const value = bag?.[name];
  return typeof value === "string" ? value : undefined;
}

function visibleRows(section: SettingsSectionDefinition) {
  return section.rows.filter(isSettingsRowVisible);
}

/** A row this frame has no markup for is drawn by the house renderer, so it is never dropped. */
function HouseRow({
  section,
  row,
}: {
  section: SettingsSectionDefinition;
  row: SettingsRowDefinition;
}) {
  return <HouseSettingsSections sections={[{ id: section.id, rows: [row] }]} />;
}

function CustomRow({ row }: { row: Row<"custom"> }) {
  const Custom = row.component;
  return <Custom tags={settingsTags(row.id, "settings.custom-row")} />;
}

function buttonVariant(action: SettingsRowAction) {
  if (action.intent === "primary") return undefined;
  return action.intent === "danger" ? "destructive" : "outline";
}

/** A dialog stays as it is while the action that owns it is writing. */
function unlessPending(
  action: SettingsRowAction,
  setOpen: (open: boolean) => void,
) {
  return (open: boolean) => {
    if (action.pending) return;
    setOpen(open);
  };
}

/**
 * The dialog of an action. A body that draws its own window is mounted bare
 * while the dialog is open; any other body sits in the app's dialog window and
 * gets the dialog's tags for its own root.
 */
function ActionDialog({
  rid,
  action,
  open,
  setOpen,
}: {
  rid: string;
  action: SettingsRowAction;
  open: boolean;
  setOpen: (open: boolean) => void;
}) {
  const trigger = action.trigger;
  if (trigger.kind !== "dialog") return null;
  const Body = trigger.body;
  const close = () => setOpen(false);
  const tags = settingsTags(`${rid}.dialog`, "settings.dialog");
  if (trigger.chrome === "body") {
    return open && Body ? <Body close={close} tags={tags} /> : null;
  }
  return (
    <Dialog open={open} onOpenChange={unlessPending(action, setOpen)}>
      <DialogContent {...(Body ? {} : tags)}>
        <DialogHeader>
          <DialogTitle {...(trigger.titleId ? { id: trigger.titleId } : {})}>
            {trigger.title}
          </DialogTitle>
          {trigger.description ? (
            <DialogDescription className="sr-only">
              {trigger.description}
            </DialogDescription>
          ) : null}
        </DialogHeader>
        {Body ? <Body close={close} tags={tags} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function runsOrOpens(action: SettingsRowAction) {
  return action.trigger.kind === "invoke" || action.trigger.kind === "dialog";
}

/** A row with nothing but its label, description and control to draw. */
function isBare(row: SettingsRowDefinition) {
  return !row.state && !row.error && !row.status && !row.labelHidden;
}

function GroupToggleRow({ row }: { row: ToggleRow }) {
  const write = useSettingsWrite(row.binding);
  return (
    <div
      className="agent-native-settings-row scroll-mt-16 px-5 py-4 sm:px-6"
      {...(row.anchorId ? { id: row.anchorId } : {})}
      {...settingsTags(row.id, "settings.row")}
    >
      <div className="agent-native-settings-row__layout flex flex-col gap-3">
        <div className="agent-native-settings-row__main flex min-w-0 flex-1 gap-3">
          {row.icon ? (
            <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-background text-muted-foreground [&>svg]:size-[18px]">
              {row.icon}
            </span>
          ) : null}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className="text-sm font-medium text-foreground"
                {...(row.labelId ? { id: row.labelId } : {})}
              >
                {row.label}
              </span>
            </div>
            {row.description ? (
              <p
                className="mt-1 max-w-xl text-sm leading-6 text-muted-foreground"
                {...(row.descriptionId ? { id: row.descriptionId } : {})}
              >
                {row.description}
              </p>
            ) : null}
          </div>
        </div>
        <div
          className="agent-native-settings-row__control max-w-full shrink-0"
          {...settingsTags(row.id, "settings.row.control")}
        >
          <Switch
            {...(row.controlId ? { id: row.controlId } : {})}
            aria-label={row.controlLabel ?? row.label}
            checked={row.binding.value}
            disabled={isSettingsRowDisabled(row)}
            onChange={(next: boolean) => write.write(next)}
          />
        </div>
      </div>
    </div>
  );
}

function GroupActionRow({ row }: { row: Row<"action"> }) {
  const action = row.action;
  const state = useSettingsAction(action);
  return (
    <>
      <Button
        className="self-start"
        variant={buttonVariant(action)}
        disabled={state.disabled}
        onClick={state.activate}
        {...(row.controlId ? { id: row.controlId } : {})}
        {...(action.accessibleLabel
          ? { "aria-label": action.accessibleLabel }
          : {})}
        {...settingsTags(row.id, "settings.row.control")}
      >
        {action.icon}
        {action.label}
      </Button>
      <ActionDialog
        rid={row.id}
        action={action}
        open={state.open}
        setOpen={state.setOpen}
      />
    </>
  );
}

/**
 * A text area that is read until its edit control is pressed: the value in a
 * bordered box, with one button in the box's bar that starts the edit and then
 * saves it.
 */
function GroupViewTextRow({ row }: { row: TextRow }) {
  const draft = useSettingsTextDraft(row);
  const state = row.state;
  const disabled = isSettingsRowDisabled(row);
  const value = row.binding.value;
  return (
    <section
      className="space-y-3 px-5 py-4"
      aria-label={row.label}
      {...settingsTags(row.id, "settings.row")}
    >
      <h3
        className="text-sm font-medium"
        {...(row.labelId ? { id: row.labelId } : {})}
      >
        {row.label}
      </h3>
      {row.description ? (
        <p
          className="text-sm text-muted-foreground"
          {...(row.descriptionId ? { id: row.descriptionId } : {})}
        >
          {row.description}
        </p>
      ) : null}
      {state?.status === "loading" ? (
        <p role="status">{state.label}</p>
      ) : state?.status === "error" ? (
        <div>
          <p role="alert">{state.message}</p>
          {state.retry && state.retryLabel ? (
            <Button variant="outline" onClick={state.retry}>
              {state.retryLabel}
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="rounded-sm border">
          <div className="flex justify-end border-b bg-muted px-3 py-2">
            <Button
              size="sm"
              disabled={disabled}
              onClick={draft.editing ? draft.save : draft.startEditing}
              {...(draft.editing
                ? settingsTags(`${row.id}.save`, "settings.row.action")
                : settingsTags(row.id, "settings.row.control"))}
            >
              {draft.editing ? row.saveLabel : (row.editLabel ?? row.label)}
            </Button>
          </div>
          {draft.editing ? (
            <Textarea
              aria-label={row.controlLabel ?? row.label}
              className="min-h-32 border-0"
              value={draft.value}
              disabled={disabled}
              onChange={(event) => draft.change(event.target.value)}
              {...(row.controlId ? { id: row.controlId } : {})}
              {...(row.maxLength === undefined
                ? {}
                : { maxLength: row.maxLength })}
              {...settingsTags(row.id, "settings.row.control")}
            />
          ) : (
            <div
              className="min-h-32 whitespace-pre-wrap p-4 text-sm"
              {...settingsTags(row.id, "settings.row.value")}
            >
              {value === "" && row.emptyValue ? (
                <>
                  <p>{row.emptyValue.label}</p>
                  {row.emptyValue.description ? (
                    <p className="text-muted-foreground">
                      {row.emptyValue.description}
                    </p>
                  ) : null}
                </>
              ) : (
                value
              )}
            </div>
          )}
        </div>
      )}
      {row.error ? (
        <p
          className="text-sm text-destructive"
          role="alert"
          {...settingsTags(row.id, "settings.row.error")}
        >
          {row.error}
        </p>
      ) : null}
    </section>
  );
}

function GroupRow({
  section,
  row,
}: {
  section: SettingsSectionDefinition;
  row: SettingsRowDefinition;
}) {
  if (row.kind === "toggle" && isBare(row) && !row.binding.confirm) {
    return <GroupToggleRow row={row} />;
  }
  if (
    row.kind === "action" &&
    isBare(row) &&
    runsOrOpens(row.action) &&
    !row.action.error
  ) {
    return <GroupActionRow row={row} />;
  }
  if (
    row.kind === "textarea" &&
    row.mode === "view" &&
    row.saveLabel &&
    !row.cancelLabel &&
    !row.status &&
    !row.labelHidden
  ) {
    return <GroupViewTextRow row={row} />;
  }
  if (row.kind === "custom") return <CustomRow row={row} />;
  return <HouseRow section={section} row={row} />;
}

function GroupSection({ section }: { section: SettingsSectionDefinition }) {
  const state = section.state;
  const heading = {
    ...(section.headingId ? { id: section.headingId } : {}),
    ...(section.label ? { title: section.label } : {}),
    ...(section.description ? { description: section.description } : {}),
  };
  return (
    <SettingsGroup {...heading}>
      {section.notice ? (
        <div role={section.notice.tone === "neutral" ? "status" : "alert"}>
          {section.notice.message}
        </div>
      ) : null}
      {state?.status === "loading" ? (
        <div aria-busy="true" className="space-y-3 p-5">
          <Skeleton className="h-5 w-2/5" />
          <Skeleton className="h-9 w-1/4" />
        </div>
      ) : state?.status === "error" ? (
        <div role="alert">
          {state.message}
          {state.retry && state.retryLabel ? (
            <>
              {" "}
              <Button onClick={state.retry}>{state.retryLabel}</Button>
            </>
          ) : null}
        </div>
      ) : (
        visibleRows(section).map((row) => (
          <GroupRow key={row.id} section={section} row={row} />
        ))
      )}
    </SettingsGroup>
  );
}

/** Each section is a titled group; its rows sit inside the group's card. */
function GroupFrame({ sections }: SettingsSectionsProps) {
  return (
    <>
      {sections.map((section) => (
        <GroupSection key={section.id} section={section} />
      ))}
    </>
  );
}

function StackItemAction({
  rid,
  item,
  action,
}: {
  rid: string;
  item: SettingsCollectionItem;
  action: SettingsRowAction;
}) {
  const state = useSettingsAction(action);
  if (action.condition?.visible === false) return null;
  return (
    <Button
      disabled={state.disabled}
      onClick={state.activate}
      size="sm"
      type="button"
      variant={buttonVariant(action)}
      {...(action.accessibleLabel
        ? { "aria-label": action.accessibleLabel }
        : {})}
      {...settingsTags(
        `${rid}.item.${action.id}`,
        "settings.collection.action",
        item.key,
      )}
    >
      {action.icon}
      {action.label}
    </Button>
  );
}

/** What the list markup can show: a title, one more line and buttons that run something. */
function stackCollectionSupported(row: Row<"collection">) {
  if (
    row.add ||
    row.search ||
    row.paging ||
    row.filter ||
    row.columns?.length ||
    row.actions?.length ||
    row.state ||
    row.status
  ) {
    return false;
  }
  if (row.items.status === "error") return !row.items.retry && !row.items.title;
  if (row.items.status === "loading") return row.items.label !== undefined;
  return row.items.value.every(
    (item) =>
      !item.href &&
      !item.badges?.length &&
      !item.cells &&
      !item.group &&
      !item.rename &&
      (item.actions ?? []).every(
        (action) => action.trigger.kind === "invoke" && !action.error,
      ),
  );
}

function StackCollectionRow({ row }: { row: Row<"collection"> }) {
  const code = hint(row.hints, "itemDescription") === "code";
  const items = row.items;
  const heading = row.labelHidden ? null : (
    <h2 className="text-sm font-semibold text-foreground" id={row.labelId}>
      {row.label}
    </h2>
  );
  let list: ReactNode;
  if (items.status === "loading") {
    list = <p className="text-sm text-muted-foreground">{items.label}</p>;
  } else if (items.status === "error") {
    list = (
      <p className="text-sm text-destructive" role="alert">
        {items.message}
      </p>
    );
  } else if (items.value.length === 0) {
    list =
      row.emptyLabel === undefined ? null : (
        <p
          className="text-sm text-muted-foreground"
          {...settingsTags(`${row.id}.empty`, "settings.collection.empty")}
        >
          {row.emptyLabel}
        </p>
      );
  } else {
    list = (
      <ul className="divide-y divide-border rounded-lg border border-border">
        {items.value.map((item) => (
          <li
            className="flex items-center gap-3 p-3"
            {...item.attributes}
            {...settingsTags(
              `${row.id}.item`,
              "settings.collection.item",
              item.key,
            )}
            key={item.key}
          >
            {item.leading}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">
                {item.title}
              </p>
              {item.description ? (
                <p
                  className={
                    code
                      ? "truncate font-mono text-xs text-muted-foreground"
                      : "text-xs text-muted-foreground"
                  }
                >
                  {item.description}
                </p>
              ) : null}
            </div>
            {item.actions?.map((action) => (
              <StackItemAction
                key={action.id}
                rid={row.id}
                item={item}
                action={action}
              />
            ))}
          </li>
        ))}
      </ul>
    );
  }
  return (
    <section
      {...(row.labelId
        ? { "aria-labelledby": row.labelId }
        : { "aria-label": row.label })}
      className="space-y-3"
      {...settingsTags(row.id, "settings.row")}
    >
      {row.description ? (
        <div>
          {heading}
          <p
            className="mt-1 text-sm text-muted-foreground"
            {...(row.descriptionId ? { id: row.descriptionId } : {})}
          >
            {row.description}
          </p>
        </div>
      ) : (
        heading
      )}
      {list}
      {row.footer ? (
        <p className="text-xs text-muted-foreground">{row.footer}</p>
      ) : null}
      {row.error ? (
        <p
          className="text-sm text-destructive"
          role="alert"
          {...settingsTags(row.id, "settings.row.error")}
        >
          {row.error}
        </p>
      ) : null}
    </section>
  );
}

function StackActionRow({ row }: { row: Row<"action"> }) {
  const action = row.action;
  const state = useSettingsAction(action);
  const reason = row.condition?.disabledReason;
  return (
    <div className="space-y-3" {...settingsTags(row.id, "settings.row")}>
      {row.description ? (
        <p
          className="text-sm text-muted-foreground"
          {...(row.descriptionId ? { id: row.descriptionId } : {})}
        >
          {row.description}
        </p>
      ) : null}
      {reason ? (
        <p
          className="text-sm"
          role="status"
          data-part="settings.row.disabled-reason"
        >
          {reason}
        </p>
      ) : null}
      <Button
        disabled={state.disabled}
        onClick={state.activate}
        size="sm"
        type="button"
        variant={buttonVariant(action)}
        {...(row.controlId ? { id: row.controlId } : {})}
        {...(action.accessibleLabel
          ? { "aria-label": action.accessibleLabel }
          : {})}
        {...settingsTags(row.id, "settings.row.control")}
      >
        {action.icon}
        {action.label}
      </Button>
      {action.error ? (
        <p
          className="text-sm text-destructive"
          role="alert"
          {...settingsTags(row.id, "settings.row.error")}
        >
          {action.error}
        </p>
      ) : null}
      <ActionDialog
        rid={row.id}
        action={action}
        open={state.open}
        setOpen={state.setOpen}
      />
    </div>
  );
}

function StackInfoRow({ row }: { row: Row<"info"> }) {
  return (
    <p
      className="text-sm text-muted-foreground"
      {...settingsTags(row.id, "settings.row")}
    >
      {row.value}
    </p>
  );
}

function StackRow({
  section,
  row,
}: {
  section: SettingsSectionDefinition;
  row: SettingsRowDefinition;
}) {
  if (row.kind === "collection" && stackCollectionSupported(row)) {
    return <StackCollectionRow row={row} />;
  }
  if (
    row.kind === "action" &&
    runsOrOpens(row.action) &&
    !row.state &&
    !row.error &&
    !row.status
  ) {
    return <StackActionRow row={row} />;
  }
  if (row.kind === "info" && !row.copyLabel && isBare(row)) {
    return <StackInfoRow row={row} />;
  }
  if (row.kind === "custom") return <CustomRow row={row} />;
  return <HouseRow section={section} row={row} />;
}

function StackSection({ section }: { section: SettingsSectionDefinition }) {
  const state = section.state;
  if (state?.status === "loading") {
    return <p className="text-sm text-muted-foreground">{state.label}</p>;
  }
  if (state?.status === "error") {
    return (
      <p className="text-sm text-destructive" role="alert">
        {state.message}
      </p>
    );
  }
  return (
    <>
      {visibleRows(section).map((row) => (
        <StackRow key={row.id} section={section} row={row} />
      ))}
    </>
  );
}

/**
 * No section chrome: each row is a block of its own, stacked where the panel is
 * mounted. A collection is a headed list, an action a short block around its
 * button, an info row a line of text.
 */
function StackFrame({ sections }: SettingsSectionsProps) {
  return (
    <>
      {sections.map((section) => (
        <StackSection key={section.id} section={section} />
      ))}
    </>
  );
}

function CatalogItemAction({
  rid,
  item,
  action,
}: {
  rid: string;
  item: SettingsCollectionItem;
  action: SettingsRowAction;
}) {
  const state = useSettingsAction(action);
  if (action.condition?.visible === false) return null;
  return (
    <button
      type="button"
      className="ws-label-remove"
      aria-label={action.accessibleLabel}
      disabled={state.disabled}
      onClick={state.activate}
      {...settingsTags(
        `${rid}.item.${action.id}`,
        "settings.collection.action",
        item.key,
      )}
    >
      {action.label}
    </button>
  );
}

/** The add form, always open under the list: every control in one row, then the message of a submit that did not save. */
function CatalogAddForm({ rid, add }: { rid: string; add: FieldsAdd }) {
  const id = useId();
  const form = useSettingsCollectionAdd(add);
  const controlId = (field: FieldsAdd["fields"][number]) =>
    field.controlId ?? `${id}-${field.id}`;
  return (
    <form
      className="ws-label-create"
      onSubmit={(event) => {
        event.preventDefault();
        void form.submit();
      }}
    >
      {add.fields.map((field) =>
        field.kind === "text" ? (
          <label
            className="ws-label-create-label"
            htmlFor={controlId(field)}
            key={field.id}
          >
            {field.label}
          </label>
        ) : null,
      )}
      <div className="ws-label-create-row">
        {add.fields.map((field) => {
          const value = form.values[field.id];
          const tags = settingsTags(
            `${rid}.add.${field.id}`,
            "settings.collection.field",
          );
          if (field.kind === "text") {
            return (
              <input
                key={field.id}
                id={controlId(field)}
                className="ws-label-create-input"
                type="text"
                value={typeof value === "string" ? value : ""}
                maxLength={field.maxLength}
                placeholder={field.placeholder}
                disabled={form.submitting}
                onChange={(event) => form.set(field.id, event.target.value)}
                {...tags}
              />
            );
          }
          if (field.kind === "color") {
            return (
              <span className="ws-label-swatches" key={field.id} {...tags}>
                {field.options.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className="ws-label-swatch"
                    aria-label={option.label}
                    aria-pressed={value === option.value}
                    style={{ background: option.value }}
                    onClick={() => form.set(field.id, option.value)}
                  />
                ))}
              </span>
            );
          }
          return null;
        })}
        <button
          type="submit"
          className="ws-label-create-submit"
          disabled={!form.canSubmit}
          {...settingsTags(`${rid}.add.submit`, "settings.dialog.action")}
        >
          {add.submitLabel}
        </button>
      </div>
      {form.error != null ? (
        <p
          className="ws-field-error"
          role="alert"
          {...settingsTags(`${rid}.add.error`, "settings.collection.error")}
        >
          {form.error}
        </p>
      ) : null}
    </form>
  );
}

/** What the catalogue markup can show: named items with a mark, a button each, and a form of text and color fields. */
function catalogCollectionSupported(row: Row<"collection">) {
  if (
    row.search ||
    row.paging ||
    row.filter ||
    row.columns?.length ||
    row.actions?.length ||
    row.footer ||
    !isBare(row)
  ) {
    return false;
  }
  if (row.add) {
    if (row.add.kind !== "fields") return false;
    if (
      !row.add.fields.every(
        (field) =>
          (field.kind === "text" || field.kind === "color") &&
          !field.description,
      )
    ) {
      return false;
    }
  }
  if (row.items.status !== "ready") return false;
  return row.items.value.every(
    (item) =>
      !item.href &&
      !item.description &&
      !item.badges?.length &&
      !item.cells &&
      !item.group &&
      !item.rename &&
      (item.actions ?? []).every(
        (action) => action.trigger.kind === "invoke" && !action.error,
      ),
  );
}

function CatalogCollectionRow({ row }: { row: Row<"collection"> }) {
  const items = row.items.status === "ready" ? row.items.value : [];
  return (
    <section
      className="ws-labels-section"
      aria-label={row.label}
      {...settingsTags(row.id, "settings.row")}
    >
      <h2 className="ws-labels-title">{row.label}</h2>
      {row.description ? (
        <p className="ws-labels-description">{row.description}</p>
      ) : null}
      {items.length === 0 ? (
        row.emptyLabel === undefined ? null : (
          <p
            className="ws-label-empty"
            {...settingsTags(`${row.id}.empty`, "settings.collection.empty")}
          >
            {row.emptyLabel}
          </p>
        )
      ) : (
        <ul className="ws-label-list">
          {items.map((item) => (
            <li
              className="ws-label-item"
              key={item.key}
              {...item.attributes}
              {...settingsTags(
                `${row.id}.item`,
                "settings.collection.item",
                item.key,
              )}
            >
              {item.leading}
              <span className="ws-label-name">{item.title}</span>
              {item.actions?.map((action) => (
                <CatalogItemAction
                  key={action.id}
                  rid={row.id}
                  item={item}
                  action={action}
                />
              ))}
            </li>
          ))}
        </ul>
      )}
      {row.add?.kind === "fields" ? (
        <CatalogAddForm rid={row.id} add={row.add} />
      ) : null}
    </section>
  );
}

/** No section chrome: each collection is a titled catalogue with its add form under the list. */
function CatalogFrame({ sections }: SettingsSectionsProps) {
  return (
    <>
      {sections.flatMap((section) =>
        visibleRows(section).map((row) =>
          row.kind === "collection" && catalogCollectionSupported(row) ? (
            <CatalogCollectionRow key={row.id} row={row} />
          ) : row.kind === "custom" ? (
            <CustomRow key={row.id} row={row} />
          ) : (
            <HouseRow key={row.id} section={section} row={row} />
          ),
        ),
      )}
    </>
  );
}

function PanelButton({
  rid,
  part,
  action,
}: {
  rid: string;
  part: string;
  action: SettingsRowAction;
}) {
  const state = useSettingsAction(action);
  return (
    <>
      <button
        type="button"
        className="data-button"
        aria-label={action.accessibleLabel}
        disabled={state.disabled}
        onClick={state.activate}
        {...settingsTags(rid, part)}
      >
        {action.icon}
        {action.label}
      </button>
      <ActionDialog
        rid={rid}
        action={action}
        open={state.open}
        setOpen={state.setOpen}
      />
    </>
  );
}

function PanelLinkRow({ row }: { row: Row<"link"> }) {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      className="data-button"
      onClick={() => void navigate(row.href)}
      {...settingsTags(row.id, "settings.row.control")}
    >
      {row.linkLabel ?? row.label}
    </button>
  );
}

/** The panel has no dialog window of its own, so a dialog's body has to bring one. */
function panelActionSupported(action: SettingsRowAction) {
  const trigger = action.trigger;
  if (action.error) return false;
  if (trigger.kind === "invoke") return true;
  return trigger.kind === "dialog" && trigger.chrome === "body";
}

type MenuState = { open: boolean; confirming: string | null };

/**
 * One entry of an item's options menu. The menu closes when the entry's run is
 * over and left no message: at once for a run that does not wait for anything,
 * otherwise when it finishes.
 */
function PanelMenuItem({
  action,
  tags,
  onDone,
  onAsk,
}: {
  action: SettingsRowAction;
  tags: Readonly<Record<string, string>>;
  onDone: () => void;
  onAsk: () => void;
}) {
  const trigger = action.trigger;
  const state = useSettingsAction(
    trigger.kind === "invoke"
      ? {
          ...action,
          trigger: {
            ...trigger,
            run: () => {
              const result = trigger.run();
              if (!(result instanceof Promise)) onDone();
              return result;
            },
          },
        }
      : action,
  );
  const started = useRef(false);
  useEffect(() => {
    if (state.running) {
      started.current = true;
    } else if (started.current) {
      started.current = false;
      if (!action.error) onDone();
    }
  });
  if (action.condition?.visible === false) return null;
  return (
    <button
      role="menuitem"
      type="button"
      disabled={state.disabled}
      title={action.condition?.disabledReason}
      {...(action.intent === "danger" ? { className: "data-danger" } : {})}
      onClick={() => {
        if (action.trigger.kind === "confirm") onAsk();
        else state.activate();
      }}
      {...tags}
    >
      {action.label}
    </button>
  );
}

/**
 * The question an item's action asks before it runs, drawn in place under the
 * menu button. It closes when the run succeeds and stays for another try when
 * the run fails.
 */
function PanelConfirmation({
  rid,
  item,
  action,
  close,
}: {
  rid: string;
  item: SettingsCollectionItem;
  action: SettingsRowAction;
  close: () => void;
}) {
  const state = useSettingsAction(action);
  const confirmRef = useRef<HTMLButtonElement>(null);
  useConfirmDialogBehavior({ confirmRef, onCancel: close });
  const asked = useRef(false);
  useEffect(() => {
    if (!asked.current) {
      asked.current = true;
      state.setOpen(true);
    } else if (!state.open) {
      close();
    }
  }, [state.open]);
  const trigger = action.trigger;
  if (trigger.kind !== "confirm") return null;
  const base = `${rid}.item.${action.id}.dialog`;
  return (
    <div
      role="alertdialog"
      aria-label={trigger.title}
      className="data-delete-confirm"
      {...settingsTags(base, "settings.dialog", item.key)}
    >
      <h3 {...(trigger.titleId ? { id: trigger.titleId } : {})}>
        {trigger.title}
      </h3>
      <p>{trigger.description}</p>
      <div className="data-button-row">
        <button
          type="button"
          className="data-button"
          onClick={close}
          {...settingsTags(
            `${base}.cancel`,
            "settings.dialog.action",
            item.key,
          )}
        >
          {trigger.cancelLabel}
        </button>
        <button
          ref={confirmRef}
          type="button"
          className="data-button data-danger"
          disabled={state.running}
          onClick={() => void state.confirm()}
          {...settingsTags(
            `${base}.confirm`,
            "settings.dialog.action",
            item.key,
          )}
        >
          {trigger.confirmLabel}
        </button>
      </div>
    </div>
  );
}

/** An item's actions behind one options button, with their messages under it. */
function PanelItemMenu({
  rid,
  item,
  label,
}: {
  rid: string;
  item: SettingsCollectionItem;
  /** The name of the options button, from the collection's `itemActionsLabel`. */
  label: string | undefined;
}) {
  const [state, setState] = useState<MenuState>({
    open: false,
    confirming: null,
  });
  const menu = useRef<HTMLDivElement>(null);
  const open = state.open;
  const setOpen = (next: boolean) =>
    setState((current) => ({ ...current, open: next }));
  useEffect(() => {
    if (!open) return;
    const element = menu.current;
    element
      ?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')
      ?.focus();
    function outside(event: MouseEvent) {
      if (event.target instanceof Node && !element?.contains(event.target))
        setOpen(false);
    }
    document.addEventListener("mousedown", outside);
    return () => document.removeEventListener("mousedown", outside);
  }, [open]);
  const actions = item.actions ?? [];
  const asking = actions.find((action) => action.id === state.confirming);
  return (
    <div
      className="data-menu-container"
      ref={menu}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          setOpen(false);
          menu.current
            ?.querySelector<HTMLButtonElement>("button[aria-haspopup]")
            ?.focus();
        }
        if (["ArrowDown", "ArrowUp"].includes(event.key)) {
          const items = [
            ...(menu.current?.querySelectorAll<HTMLButtonElement>(
              '[role="menuitem"]:not(:disabled)',
            ) ?? []),
          ];
          const index = items.indexOf(
            document.activeElement as HTMLButtonElement,
          );
          event.preventDefault();
          items[
            (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) %
              items.length
          ]?.focus();
        }
      }}
    >
      <button
        type="button"
        className="data-icon-button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        {...settingsTags(
          `${rid}.item.options`,
          "settings.collection.action",
          item.key,
        )}
      >
        <IconDots size={16} />
      </button>
      {open && (
        <div role="menu" className="data-connection-menu">
          {actions.map((action) => (
            <PanelMenuItem
              key={action.id}
              action={action}
              tags={settingsTags(
                `${rid}.item.${action.id}`,
                "settings.collection.action",
                item.key,
              )}
              onDone={() => setOpen(false)}
              onAsk={() => setState({ open: false, confirming: action.id })}
            />
          ))}
        </div>
      )}
      {asking ? (
        <PanelConfirmation
          rid={rid}
          item={item}
          action={asking}
          close={() =>
            setState((current) => ({ ...current, confirming: null }))
          }
        />
      ) : null}
      {actions.map((action) =>
        action.error ? (
          <p
            role="alert"
            className="data-field-error"
            key={action.id}
            {...settingsTags(
              `${rid}.item.${action.id}`,
              "settings.collection.action",
              item.key,
            )}
          >
            {action.error}
          </p>
        ) : null,
      )}
    </div>
  );
}

/** What the table markup can show: a title with tags and one more line, plain text cells, and a menu of actions. */
function panelCollectionSupported(row: Row<"collection">) {
  if (row.search || row.paging || row.filter || row.footer || !isBare(row)) {
    return false;
  }
  if (row.actions?.length) return false;
  if (
    row.add &&
    (row.add.kind !== "trigger" || !panelActionSupported(row.add.action))
  ) {
    return false;
  }
  if (row.items.status === "loading") return row.items.label !== undefined;
  if (row.items.status === "error") return !row.items.retry && !row.items.title;
  return row.items.value.every(
    (item) =>
      !item.href &&
      !item.leading &&
      !item.group &&
      !item.rename &&
      (item.badges ?? []).every((badge) => typeof badge === "string") &&
      Object.values(item.cells ?? {}).every(
        (cell) => typeof cell === "string",
      ) &&
      (item.actions ?? []).every(
        (action) =>
          action.trigger.kind === "invoke" || action.trigger.kind === "confirm",
      ),
  );
}

function PanelTable({ row }: { row: Row<"collection"> }) {
  const columns = row.columns ?? [];
  const items = row.items;
  if (items.status === "error") {
    return (
      <div role="alert" {...settingsTags(row.id, "settings.row")}>
        {items.message}
      </div>
    );
  }
  const list = items.status === "ready" ? items.value : [];
  const empty = items.status === "loading" ? items.label : row.emptyLabel;
  return (
    <table
      className="data-connections-table"
      {...settingsTags(row.id, "settings.row")}
    >
      <thead>
        <tr>
          {columns.map((column) => (
            <th key={column.id} aria-sort={column.sort}>
              {column.sort === undefined ? (
                column.label
              ) : (
                <button
                  type="button"
                  onClick={() => row.onSort?.(column.id)}
                  {...settingsTags(
                    `${row.id}.sort.${column.id}`,
                    "settings.collection.sort",
                  )}
                >
                  {column.label}
                </button>
              )}
            </th>
          ))}
          <th aria-label={row.actionsLabel} />
        </tr>
      </thead>
      <tbody>
        {list.map((item) => (
          <tr
            key={item.key}
            {...item.attributes}
            {...settingsTags(
              `${row.id}.item`,
              "settings.collection.item",
              item.key,
            )}
          >
            <td>
              <div className="data-settings-name">
                {item.title}
                {item.badges?.map((badge) =>
                  typeof badge === "string" ? (
                    <span className="data-tag" key={badge}>
                      {badge}
                    </span>
                  ) : null,
                )}
              </div>
              {item.description ? (
                <p className="data-muted">{item.description}</p>
              ) : null}
            </td>
            {columns.map((column) => {
              const cell = item.cells?.[column.id];
              return typeof cell === "string" ? (
                <td key={column.id}>{cell}</td>
              ) : null;
            })}
            <td>
              <PanelItemMenu
                rid={row.id}
                item={item}
                label={row.itemActionsLabel?.replace("{title}", item.title)}
              />
            </td>
          </tr>
        ))}
        {!list.length && empty !== undefined && (
          <tr>
            <td
              colSpan={columns.length + 1}
              className="data-settings-empty"
              {...(items.status === "ready"
                ? settingsTags(`${row.id}.empty`, "settings.collection.empty")
                : {})}
            >
              {empty}
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

function PanelRow({
  section,
  row,
}: {
  section: SettingsSectionDefinition;
  row: SettingsRowDefinition;
}) {
  if (row.kind === "collection" && panelCollectionSupported(row)) {
    return <PanelTable row={row} />;
  }
  if (
    row.kind === "action" &&
    isBare(row) &&
    panelActionSupported(row.action)
  ) {
    return (
      <PanelButton
        rid={row.id}
        part="settings.row.control"
        action={row.action}
      />
    );
  }
  if (row.kind === "link" && !row.external && isBare(row) && !row.value) {
    return <PanelLinkRow row={row} />;
  }
  if (row.kind === "custom") return <CustomRow row={row} />;
  return <HouseRow section={section} row={row} />;
}

function PanelSection({ section }: { section: SettingsSectionDefinition }) {
  const rows = visibleRows(section);
  // The `placement` hint puts a row in the panel's header or footer; the rest
  // is the body. A table's add control sits in the header with them.
  const placed = (placement: string) =>
    rows
      .filter((row) => hint(row.hints, "placement") === placement)
      .map((row) => <PanelRow key={row.id} section={section} row={row} />);
  const adds = rows.map((row) =>
    row.kind === "collection" &&
    panelCollectionSupported(row) &&
    row.add?.kind === "trigger" ? (
      <PanelButton
        key={`${row.id}.add`}
        rid={`${row.id}.add`}
        part="settings.collection.add"
        action={row.add.action}
      />
    ) : null,
  );
  const body = rows
    .filter((row) => {
      const placement = hint(row.hints, "placement");
      return placement !== "header" && placement !== "footer";
    })
    .map((row) => <PanelRow key={row.id} section={section} row={row} />);
  const footer = placed("footer");
  return (
    <>
      {section.notice ? (
        <p
          role={section.notice.tone === "neutral" ? "status" : "alert"}
          style={{ marginBottom: 12 }}
        >
          {section.notice.message}
        </p>
      ) : null}
      <section className="data-workspace-connections">
        <header className="data-settings-header">
          <div>
            <h2 {...(section.headingId ? { id: section.headingId } : {})}>
              {section.label}
            </h2>
            <p>{section.description}</p>
          </div>
          {placed("header")}
          {adds}
        </header>
        {body}
        {footer.length > 0 && (
          <footer className="data-settings-footer">{footer}</footer>
        )}
      </section>
    </>
  );
}

/**
 * Each section is a panel: a header with its actions, a body and a footer. With
 * a title or a description the panels sit in a page section under that heading.
 */
function PanelFrame({ sections, title, description }: SettingsSectionsProps) {
  const panels = sections.map((section) => (
    <PanelSection key={section.id} section={section} />
  ));
  if (!title && !description) return <>{panels}</>;
  return (
    <section>
      <header style={{ marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 600 }}>{title}</h1>
        <p style={{ margin: "6px 0 0", opacity: 0.75 }}>{description}</p>
      </header>
      {panels}
    </section>
  );
}

export const frames: Readonly<Record<string, ReferenceSettingsFrame>> = {
  group: GroupFrame,
  stack: StackFrame,
  catalog: CatalogFrame,
  panel: PanelFrame,
};
