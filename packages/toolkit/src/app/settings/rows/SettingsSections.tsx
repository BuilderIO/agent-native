import {
  IconArrowDown,
  IconArrowUp,
  IconChevronDown,
  IconChevronRight,
  IconCopy,
  IconExternalLink,
} from "@tabler/icons-react";
import {
  createContext,
  useContext,
  useId,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import {
  useInRouterContext,
  useNavigate,
  type NavigateFunction,
} from "react-router";

import {
  ActionButton,
  Checkbox,
  Dialog,
  Picker,
  Skeleton,
  Switch,
  TextArea,
  TextField,
} from "../../../design-system/components.js";
import { Input } from "../../../ui/input.js";
import { cn } from "../../../utils.js";
import { SettingsGroup } from "../SettingsRow.js";
import {
  isSettingsRowDisabled,
  settingsTags,
  useSettingsAction,
  useSettingsCollectionAdd,
  useSettingsTextDraft,
  SettingsWriteErrorsProvider,
  useBindingWrite,
  useSettingsWrite,
  useSettingsWriteError,
  useSettingsWriteErrorStore,
} from "./hooks.js";
import { deriveSettingsSummary, isSettingsRowVisible } from "./model.js";
import {
  resolveSettingsPresentation,
  selectedSettingsAdornment,
} from "./presentation.js";
import { useSettingsSectionsRenderer } from "./renderer.js";
import type {
  SettingsBinding,
  SettingsCollectionAdd,
  SettingsCollectionCell,
  SettingsCollectionColumn,
  SettingsCollectionField,
  SettingsCollectionItem,
  SettingsRowAction,
  SettingsRowDefinition,
  SettingsSectionDefinition,
  SettingsSectionsProps,
} from "./schema.js";

/** Sets `key` only when `value` is present, so absent props stay absent. */
function optional<K extends string, V>(
  key: K,
  value: V | undefined,
): Partial<Record<K, V>> {
  const props: Partial<Record<K, V>> = {};
  if (value !== undefined) props[key] = value;
  return props;
}

/**
 * Renders settings sections from data. A `SettingsSectionsRendererProvider`
 * may replace the whole part; without one, the house renderer draws it.
 */
export function SettingsSections(props: SettingsSectionsProps) {
  const Custom = useSettingsSectionsRenderer();
  const Page = Custom ?? HouseSettingsSections;
  return <Page {...resolveSettingsPresentation(props)} />;
}

const RouterNavigateContext = createContext<NavigateFunction | null>(null);

function RouterNavigateProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  return (
    <RouterNavigateContext.Provider value={navigate}>
      {children}
    </RouterNavigateContext.Provider>
  );
}

export function HouseSettingsSections(props: SettingsSectionsProps) {
  const inRouter = useInRouterContext();
  const writeErrors = useSettingsWriteErrorStore();
  const page = (
    <SettingsWriteErrorsProvider value={writeErrors}>
      <HouseSettingsPage {...props} />
    </SettingsWriteErrorsProvider>
  );
  return inRouter ? (
    <RouterNavigateProvider>{page}</RouterNavigateProvider>
  ) : (
    page
  );
}

function HouseSettingsPage({
  sections,
  title,
  description,
  descriptionId,
}: SettingsSectionsProps) {
  return (
    <div data-part="settings.sections" data-skin="house" className="grid gap-8">
      {title || description ? (
        <header className="grid gap-1">
          {title ? (
            <h1 className="text-lg font-semibold text-foreground">{title}</h1>
          ) : null}
          {description ? (
            <p id={descriptionId} className="text-sm text-muted-foreground">
              {description}
            </p>
          ) : null}
        </header>
      ) : null}
      {sections.map((section) => (
        <HouseSection key={section.id} section={section} />
      ))}
    </div>
  );
}

const NOTICE_TONE = {
  neutral: "border-border bg-muted text-foreground",
  warning: "border-amber-500/40 bg-amber-500/10 text-foreground",
  danger: "border-destructive/40 bg-destructive/10 text-destructive",
} as const;

function HouseSection({ section }: { section: SettingsSectionDefinition }) {
  const state = section.state;
  return (
    <div data-part="settings.section" data-section={section.id}>
      <SettingsGroup
        {...optional("id", section.headingId)}
        {...optional("title", section.label)}
        {...optional("description", section.description)}
      >
        {section.notice ? (
          <div
            role={section.notice.tone === "neutral" ? "status" : "alert"}
            className={cn(
              "border-b px-5 py-3 text-sm",
              NOTICE_TONE[section.notice.tone],
            )}
          >
            {section.notice.message}
          </div>
        ) : null}
        {state?.status === "loading" ? (
          <div
            role="status"
            aria-label={state.label}
            className="grid gap-3 p-5"
          >
            {Array.from({ length: state.rows ?? 3 }, (_, index) => (
              <Skeleton key={index} height={20} />
            ))}
          </div>
        ) : state?.status === "error" ? (
          <div
            role="alert"
            className="flex items-center justify-between gap-3 p-5 text-sm text-destructive"
          >
            <span>{state.message}</span>
            {state.retry && state.retryLabel ? (
              <ActionButton
                size="compact"
                emphasis="outline"
                onPress={state.retry}
              >
                {state.retryLabel}
              </ActionButton>
            ) : null}
          </div>
        ) : (
          <HouseRows rows={section.rows} siblings={section.rows} />
        )}
      </SettingsGroup>
    </div>
  );
}

function HouseRows({
  rows,
  siblings,
}: {
  rows: readonly SettingsRowDefinition[];
  siblings: readonly SettingsRowDefinition[];
}) {
  return (
    <>
      {rows.filter(isSettingsRowVisible).map((row) => (
        <HouseRow key={row.id} row={row} siblings={siblings} />
      ))}
    </>
  );
}

const ROW_PAD = "px-5 py-4 sm:px-6";

function RowText({ row }: { row: SettingsRowDefinition }) {
  const reason = row.condition?.disabledReason;
  return (
    <span className="grid min-w-0 gap-1 text-start">
      <span
        id={row.labelId}
        className={cn(
          "text-sm font-medium text-foreground",
          row.labelHidden && "sr-only",
        )}
      >
        {row.label}
      </span>
      {row.description &&
      !(
        "descriptionPlacement" in row &&
        row.descriptionPlacement === "below-field"
      ) ? (
        <span
          id={row.descriptionId}
          className="max-w-xl text-sm leading-6 text-muted-foreground"
        >
          {row.description}
        </span>
      ) : null}
      {reason ? (
        <span
          data-part="settings.row.disabled-reason"
          className="text-sm text-muted-foreground"
        >
          {reason}
        </span>
      ) : null}
    </span>
  );
}

/** A row's own loading or failed read, shown where its control would be. */
function RowState({ row }: { row: SettingsRowDefinition }) {
  const state = row.state;
  if (!state) return null;
  if (state.status === "loading") {
    return (
      <span role="status" aria-label={state.label} className="block w-40">
        <Skeleton height={20} />
      </span>
    );
  }
  return (
    <span
      role="alert"
      className="flex items-center gap-2 text-sm text-destructive"
    >
      <span
        {...(row.kind === "toggle"
          ? settingsTags(row.id, "settings.row.control")
          : {})}
      >
        {state.message}
      </span>
      {state.retry && state.retryLabel ? (
        <ActionButton size="compact" emphasis="outline" onPress={state.retry}>
          {state.retryLabel}
        </ActionButton>
      ) : null}
    </span>
  );
}

function RowFrame({
  row,
  control,
  children,
}: {
  row: SettingsRowDefinition;
  control?: ReactNode;
  children?: ReactNode;
}) {
  const writeError = useSettingsWriteError(row.id);
  return (
    <div
      {...settingsTags(row.id, "settings.row")}
      id={row.anchorId}
      data-row-kind={row.kind}
      className={cn("agent-native-settings-row scroll-mt-16", ROW_PAD)}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <span className="flex min-w-0 flex-1 gap-3">
          {row.icon ? (
            <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-background text-muted-foreground [&>svg]:size-[18px]">
              {row.icon}
            </span>
          ) : null}
          <RowText row={row} />
        </span>
        {row.state ? <RowState row={row} /> : null}
        {(!row.state ||
          (row.state.status === "error" &&
            (row.kind === "toggle" || row.kind === "checkbox"))) &&
        control ? (
          <div className="max-w-full shrink-0">{control}</div>
        ) : null}
      </div>
      {!row.state && children ? <div className="mt-4">{children}</div> : null}
      {row.status ? (
        <p
          role="status"
          {...settingsTags(row.id, "settings.row.status")}
          className={cn(
            "mt-2 text-sm",
            row.status.tone === "danger"
              ? "text-destructive"
              : "text-muted-foreground",
          )}
        >
          {row.status.message}
        </p>
      ) : null}
      {row.error || writeError ? (
        <p
          role="alert"
          {...settingsTags(row.id, "settings.row.error")}
          className="mt-2 text-sm text-destructive"
        >
          {row.error ?? writeError}
        </p>
      ) : null}
    </div>
  );
}

function ControlTag({
  row,
  children,
}: {
  row: SettingsRowDefinition;
  children: ReactNode;
}) {
  return (
    <span
      {...settingsTags(row.id, "settings.row.control")}
      className="contents"
    >
      {children}
    </span>
  );
}

function controlName(row: SettingsRowDefinition): string {
  return row.controlLabel ?? row.label;
}

/** The dialog a confirmed write opens, tagged like an action's dialog. */
function WriteConfirmation({
  rid,
  write,
}: {
  rid: string;
  write: ReturnType<typeof useSettingsWrite<never>>;
}) {
  const confirmation = write.confirmation;
  if (!confirmation) return null;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) confirmation.cancel();
      }}
      title={confirmation.title}
      description={confirmation.description}
      size="small"
      footer={
        <>
          <span
            {...settingsTags(`${rid}.dialog.cancel`, "settings.dialog.action")}
            className="contents"
          >
            <ActionButton emphasis="outline" onPress={confirmation.cancel}>
              {confirmation.cancelLabel}
            </ActionButton>
          </span>
          <span
            {...settingsTags(`${rid}.dialog.confirm`, "settings.dialog.action")}
            className="contents"
          >
            <ActionButton
              intent={confirmation.intent === "danger" ? "danger" : "primary"}
              onPress={confirmation.confirm}
            >
              {confirmation.confirmLabel}
            </ActionButton>
          </span>
        </>
      }
    >
      <span {...settingsTags(`${rid}.dialog`, "settings.dialog")} />
    </Dialog>
  );
}

function BooleanRow({
  row,
  controlId,
}: {
  row: Extract<SettingsRowDefinition, { kind: "toggle" | "checkbox" }>;
  controlId: string;
}) {
  const write = useSettingsWrite(row.binding);
  const Control = row.kind === "toggle" ? Switch : Checkbox;
  return (
    <>
      <RowFrame
        row={row}
        control={
          <ControlTag row={row}>
            <Control
              id={controlId}
              aria-label={controlName(row)}
              checked={row.binding.value}
              disabled={isSettingsRowDisabled(row)}
              onChange={write.write}
            />
          </ControlTag>
        }
      />
      {write.error && !row.error ? (
        <p
          role="alert"
          {...settingsTags(row.id, "settings.row.error")}
          className="text-xs text-destructive"
        >
          {write.error}
        </p>
      ) : null}
      <WriteConfirmation
        rid={row.id}
        write={write as ReturnType<typeof useSettingsWrite<never>>}
      />
    </>
  );
}

function TextRowControl({
  row,
  controlId,
}: {
  row: Extract<SettingsRowDefinition, { kind: "text" | "textarea" | "time" }>;
  controlId: string;
}) {
  const draft = useSettingsTextDraft(row);
  const disabled = isSettingsRowDisabled(row);
  if (!draft.editing) {
    return (
      <span className="flex items-center gap-3">
        <span
          {...settingsTags(row.id, "settings.row.value")}
          className="whitespace-pre-wrap text-sm text-foreground"
        >
          {row.binding.value === "" && row.emptyValue ? (
            <>
              <span className="block">{row.emptyValue.label}</span>
              {row.emptyValue.description ? (
                <span className="block text-muted-foreground">
                  {row.emptyValue.description}
                </span>
              ) : null}
            </>
          ) : (
            row.binding.value
          )}
        </span>
        <span
          {...settingsTags(row.id, "settings.row.control")}
          className="contents"
        >
          <ActionButton
            size="compact"
            emphasis="outline"
            disabled={disabled}
            onPress={draft.startEditing}
          >
            {row.editLabel ?? row.label}
          </ActionButton>
        </span>
      </span>
    );
  }
  const explicit = draft.commit === "explicit";
  const buttons =
    explicit && row.saveLabel ? (
      <span className="flex items-center gap-2">
        {row.cancelLabel ? (
          <span
            {...settingsTags(`${row.id}.cancel`, "settings.row.action")}
            className="contents"
          >
            <ActionButton
              size="compact"
              emphasis="outline"
              onPress={draft.cancel}
            >
              {row.cancelLabel}
            </ActionButton>
          </span>
        ) : null}
        <span
          {...settingsTags(`${row.id}.save`, "settings.row.action")}
          className="contents"
        >
          <ActionButton
            size="compact"
            intent="primary"
            disabled={disabled || !draft.dirty}
            {...optional("pending", row.binding.pending)}
            onPress={draft.save}
          >
            {row.saveLabel}
          </ActionButton>
        </span>
      </span>
    ) : null;
  // Without a save label there is nothing to press, so the value commits on blur.
  const onBlur = explicit && !row.saveLabel ? draft.save : draft.blur;
  const support = (
    <>
      {row.counter ? (
        <span
          {...settingsTags(row.id, "settings.row.counter")}
          className="text-xs text-muted-foreground"
        >
          {draft.value.length}/{row.counter.limit}
        </span>
      ) : null}
      {row.descriptionPlacement === "below-field" && row.description ? (
        <span id={row.descriptionId} className="text-sm text-muted-foreground">
          {row.description}
        </span>
      ) : null}
    </>
  );
  if (row.kind === "textarea") {
    return (
      <div className="grid gap-2">
        <ControlTag row={row}>
          <TextArea
            id={controlId}
            aria-label={controlName(row)}
            value={draft.value}
            disabled={disabled}
            {...optional("placeholder", row.placeholder)}
            {...optional("maxLength", row.maxLength)}
            onChange={draft.change}
            onBlur={onBlur}
          />
        </ControlTag>
        {support}
        {buttons}
      </div>
    );
  }
  if (row.kind === "time") {
    return (
      <ControlTag row={row}>
        <Input
          id={controlId}
          type="time"
          aria-label={controlName(row)}
          value={draft.value}
          disabled={disabled}
          onChange={(event) => draft.change(event.currentTarget.value)}
          onBlur={onBlur}
        />
      </ControlTag>
    );
  }
  return (
    <span
      className={
        row.counter || row.descriptionPlacement
          ? "grid gap-2"
          : "flex items-center gap-2"
      }
    >
      <ControlTag row={row}>
        <TextField
          id={controlId}
          aria-label={controlName(row)}
          value={draft.value}
          disabled={disabled}
          {...optional("placeholder", row.placeholder)}
          {...(row.prefix
            ? {
                leadingContent: (
                  <span className="text-sm text-muted-foreground">
                    {row.prefix}
                  </span>
                ),
              }
            : {})}
          onChange={(next) =>
            draft.change(
              row.maxLength === undefined ? next : next.slice(0, row.maxLength),
            )
          }
          onBlur={onBlur}
          onKeyDown={draft.keyDown}
        />
      </ControlTag>
      {support}
      {buttons}
    </span>
  );
}

function HouseRow({
  row,
  siblings,
}: {
  row: SettingsRowDefinition;
  siblings: readonly SettingsRowDefinition[];
}) {
  const generatedId = useId();
  const writeBinding = useBindingWrite(row.id);
  const controlId = row.controlId ?? generatedId;
  const disabled = isSettingsRowDisabled(row);

  switch (row.kind) {
    case "toggle":
    case "checkbox":
      return <BooleanRow row={row} controlId={controlId} />;
    case "text":
    case "time":
      return (
        <RowFrame
          row={row}
          control={<TextRowControl row={row} controlId={controlId} />}
        />
      );
    case "textarea":
      return (
        <RowFrame row={row}>
          <TextRowControl row={row} controlId={controlId} />
        </RowFrame>
      );
    case "number":
      return (
        <RowFrame
          row={row}
          control={
            <ControlTag row={row}>
              <Input
                id={controlId}
                type="number"
                aria-label={controlName(row)}
                value={row.binding.value ?? ""}
                min={row.min}
                max={row.max}
                step={row.step}
                disabled={disabled}
                onChange={(event) => {
                  const raw = event.currentTarget.value;
                  void writeBinding(
                    row.binding,
                    raw === "" ? null : Number(raw),
                  );
                }}
              />
            </ControlTag>
          }
        />
      );
    case "select": {
      const adornment = selectedSettingsAdornment(
        row.options,
        row.binding.value,
      );
      const control = (
        <ControlTag row={row}>
          <Picker
            mode="select"
            id={controlId}
            aria-label={controlName(row)}
            value={row.binding.value}
            {...optional("placeholder", row.placeholder)}
            disabled={disabled}
            options={row.options.map((option) => ({
              value: option.value,
              label: option.label,
              ...optional("description", option.description),
              ...optional("disabled", option.disabled),
              icon: option.icon,
            }))}
            onChange={(value) => void writeBinding(row.binding, value)}
          />
        </ControlTag>
      );
      return (
        <RowFrame
          row={row}
          control={
            adornment ? (
              <span className="flex items-center gap-2">
                {adornment.kind === "dot" ? (
                  <span
                    aria-hidden="true"
                    className="size-2 rounded-full bg-muted-foreground"
                  />
                ) : (
                  <span
                    aria-hidden="true"
                    className="rounded-full bg-muted px-1.5 text-xs text-muted-foreground"
                  >
                    {adornment.text}
                  </span>
                )}
                {control}
              </span>
            ) : (
              control
            )
          }
        />
      );
    }
    case "radio":
    case "segmented": {
      const cards = row.options.some((option) => option.preview !== undefined);
      return (
        <RowFrame row={row}>
          <div
            role="radiogroup"
            aria-label={
              row.controlLabel ?? (row.labelId ? undefined : row.label)
            }
            aria-labelledby={row.controlLabel ? undefined : row.labelId}
            {...settingsTags(row.id, "settings.row.control")}
            className={cn(
              cards
                ? "grid gap-3 sm:grid-cols-2"
                : row.kind === "segmented"
                  ? "inline-flex rounded-lg border border-border p-0.5"
                  : "grid gap-2",
            )}
          >
            {row.options.map((option) => {
              const selected = row.binding.value === option.value;
              return (
                <button
                  key={option.value}
                  id={option.controlId}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-labelledby={`${controlId}-${option.value}-label`}
                  aria-describedby={
                    option.preview
                      ? `${controlId}-${option.value}-preview`
                      : undefined
                  }
                  disabled={disabled || option.disabled}
                  {...settingsTags(
                    `${row.id}.${option.value}`,
                    "settings.row.option",
                  )}
                  onClick={() => void writeBinding(row.binding, option.value)}
                  className={cn(
                    "rounded-md text-start text-sm",
                    cards
                      ? "grid gap-2 border p-3"
                      : "flex items-center gap-2 px-3 py-1.5",
                    selected
                      ? cards
                        ? "border-foreground"
                        : "bg-accent text-accent-foreground"
                      : cards
                        ? "border-border"
                        : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <span
                    id={`${controlId}-${option.value}-label`}
                    className="contents"
                  >
                    <span className="flex items-center gap-2">
                      {option.icon}
                      <span className="font-medium">{option.label}</span>
                    </span>
                    {option.description ? (
                      <span className="text-xs text-muted-foreground">
                        {option.description}
                      </span>
                    ) : null}
                  </span>
                  {option.preview ? (
                    <span
                      id={`${controlId}-${option.value}-preview`}
                      className="contents"
                    >
                      {option.preview}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </RowFrame>
      );
    }
    case "multi-select":
      return (
        <RowFrame row={row}>
          <MultiSelect row={row} disabled={disabled} />
        </RowFrame>
      );
    case "checkbox-group": {
      const disclosure = row.disclosure;
      if (!disclosure) {
        return (
          <RowFrame row={row}>
            <OptionGrid row={row} disabled={disabled} />
          </RowFrame>
        );
      }
      const summary = disclosure.summary
        ? deriveSettingsSummary(row, disclosure.summary, siblings)
        : null;
      return (
        <DisclosureFrame
          row={row}
          expanded={disclosure.expanded}
          setExpanded={disclosure.setExpanded}
          {...optional("panelId", disclosure.panelId)}
          summary={
            summary !== null &&
            (disclosure.summary?.when === "always" || !disclosure.expanded)
              ? summary
              : null
          }
          {...optional(
            "countId",
            disclosure.summary?.content.kind === "count"
              ? disclosure.summary.content.countId
              : undefined,
          )}
        >
          <OptionGrid row={row} disabled={disabled} />
        </DisclosureFrame>
      );
    }
    case "disclosure": {
      const summary = row.summary
        ? deriveSettingsSummary(row, row.summary, row.rows)
        : null;
      return (
        <DisclosureFrame
          row={row}
          expanded={row.expanded}
          setExpanded={row.setExpanded}
          {...optional("panelId", row.panelId)}
          summary={
            summary !== null &&
            (row.summary?.when === "always" || !row.expanded)
              ? summary
              : null
          }
        >
          <div className="overflow-hidden rounded-lg border border-border/70 divide-y divide-border/60">
            <HouseRows rows={row.rows} siblings={row.rows} />
          </div>
        </DisclosureFrame>
      );
    }
    case "group":
      return (
        <div
          {...settingsTags(row.id, "settings.row")}
          data-row-kind="group"
          role="group"
          aria-label={row.label}
          className={ROW_PAD}
        >
          {row.labelHidden ? null : <RowText row={row} />}
          <div
            className={cn(
              "overflow-hidden rounded-lg border border-border/70 divide-y divide-border/60",
              !row.labelHidden && "mt-3",
            )}
          >
            <HouseRows rows={row.rows} siblings={row.rows} />
          </div>
        </div>
      );
    case "collection":
      return <HouseCollection row={row} />;
    case "action":
      return (
        <RowFrame
          row={row}
          control={
            <HouseAction
              rid={row.id}
              part="settings.row.control"
              action={row.action}
              controlId={controlId}
              accessibleLabel={
                row.action.accessibleLabel ??
                row.controlLabel ??
                (row.controlId ? row.label : undefined)
              }
            />
          }
        >
          {row.action.error ? (
            <p
              role="alert"
              {...settingsTags(row.id, "settings.row.error")}
              className="text-sm text-destructive"
            >
              {row.action.error}
            </p>
          ) : null}
        </RowFrame>
      );
    case "link":
      return <LinkRow row={row} />;
    case "info":
      return (
        <RowFrame
          row={row}
          control={
            <span className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>{row.value}</span>
              {row.copyLabel ? (
                <span
                  {...settingsTags(`${row.id}.copy`, "settings.row.action")}
                  className="contents"
                >
                  <ActionButton
                    emphasis="ghost"
                    size="compact"
                    aria-label={row.copyLabel}
                    leadingIcon={<IconCopy aria-hidden className="size-4" />}
                    onPress={() =>
                      void navigator.clipboard.writeText(row.value)
                    }
                  />
                </span>
              ) : null}
            </span>
          }
        />
      );
    case "custom": {
      const Custom = row.component;
      return <Custom tags={settingsTags(row.id, "settings.custom-row")} />;
    }
  }
}

/**
 * A row that opens in place. The whole header is the control, so its name is
 * everything the header says: label, description and summary.
 */
function DisclosureFrame({
  row,
  expanded,
  setExpanded,
  panelId,
  summary,
  countId,
  children,
}: {
  row: SettingsRowDefinition;
  expanded: boolean;
  setExpanded: (expanded: boolean) => void;
  panelId?: string;
  summary: string | null;
  countId?: string;
  children: ReactNode;
}) {
  const generated = useId();
  const region = panelId ?? generated;
  return (
    <div {...settingsTags(row.id, "settings.row")} data-row-kind={row.kind}>
      <button
        type="button"
        id={row.controlId}
        {...settingsTags(row.id, "settings.row.control")}
        aria-expanded={expanded}
        aria-controls={expanded ? region : undefined}
        aria-label={row.controlLabel}
        disabled={Boolean(
          row.condition?.disabled || row.condition?.disabledReason,
        )}
        onClick={() => setExpanded(!expanded)}
        className={cn(
          "flex w-full items-center justify-between gap-4 text-start hover:bg-accent/40",
          ROW_PAD,
        )}
      >
        <span className="flex min-w-0 flex-1 gap-3">
          {row.icon ? (
            <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-background text-muted-foreground [&>svg]:size-[18px]">
              {row.icon}
            </span>
          ) : null}
          <RowText row={row} />
        </span>
        <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
          {summary !== null ? (
            <span
              id={countId}
              {...settingsTags(row.id, "settings.row.summary")}
            >
              {summary}
            </span>
          ) : null}
          <IconChevronDown
            aria-hidden
            className={cn(
              "size-4 transition-transform",
              expanded && "rotate-180",
            )}
          />
        </span>
      </button>
      {expanded ? (
        <div id={region} className={cn(ROW_PAD, "pt-0")}>
          {children}
        </div>
      ) : null}
    </div>
  );
}

/** A row that goes somewhere. The whole row is the link. */
function LinkRow({
  row,
}: {
  row: Extract<SettingsRowDefinition, { kind: "link" }>;
}) {
  const navigate = useRouterNavigate();
  const disabled = Boolean(
    row.condition?.disabled || row.condition?.disabledReason,
  );
  return (
    <div {...settingsTags(row.id, "settings.row")} data-row-kind="link">
      <a
        id={row.controlId}
        {...settingsTags(row.id, "settings.row.control")}
        href={row.href}
        aria-label={row.controlLabel}
        aria-disabled={disabled || undefined}
        target={row.external ? "_blank" : undefined}
        rel={row.external ? "noreferrer" : undefined}
        onClick={(event) => {
          if (disabled) event.preventDefault();
          else if (!row.external) navigate(event, row.href);
        }}
        className={cn(
          "flex items-center justify-between gap-4 hover:bg-accent/40",
          ROW_PAD,
        )}
      >
        <span className="flex min-w-0 flex-1 gap-3">
          {row.icon}
          <RowText row={row} />
        </span>
        <span className="flex shrink-0 items-center gap-2 text-sm text-muted-foreground">
          {row.value ? (
            <span {...settingsTags(row.id, "settings.row.value")}>
              {row.value}
            </span>
          ) : null}
          {row.linkLabel ? <span>{row.linkLabel}</span> : null}
          {row.external ? (
            <IconExternalLink aria-hidden className="size-4" />
          ) : (
            <IconChevronRight aria-hidden className="size-4" />
          )}
        </span>
      </a>
    </div>
  );
}

/** In-app navigation without a page load, when the part is inside a router. */
function useRouterNavigate() {
  const navigate = useContext(RouterNavigateContext);
  return (event: ReactMouseEvent<HTMLAnchorElement>, href: string) => {
    if (
      !navigate ||
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    event.preventDefault();
    void navigate(href);
  };
}

type OptionsRow = Extract<
  SettingsRowDefinition,
  { kind: "checkbox-group" | "multi-select" }
>;

function toggleOption(
  row: OptionsRow,
  write: ReturnType<typeof useBindingWrite>,
  value: string,
  checked: boolean,
) {
  const next = checked
    ? [...new Set([...row.binding.value, value])]
    : row.binding.value.filter((current) => current !== value);
  void write(row.binding, next);
}

function OptionGrid({
  row,
  disabled,
  options = row.options,
}: {
  row: OptionsRow;
  disabled: boolean;
  options?: OptionsRow["options"];
}) {
  const write = useBindingWrite(row.id);
  const selected = new Set(row.binding.value);
  return (
    <div
      role="group"
      aria-label={controlName(row)}
      className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2"
    >
      {options.map((option) => (
        <span
          key={option.value}
          {...settingsTags(`${row.id}.${option.value}`, "settings.row.option")}
          className="flex min-h-9 items-center"
        >
          <Checkbox
            {...optional("id", option.controlId)}
            label={option.label}
            aria-label={option.label}
            {...optional("description", option.description)}
            checked={selected.has(option.value)}
            {...optional("disabled", disabled || option.disabled)}
            onChange={(checked) =>
              toggleOption(row, write, option.value, checked)
            }
          />
        </span>
      ))}
    </div>
  );
}

function MultiSelect({
  row,
  disabled,
}: {
  row: Extract<SettingsRowDefinition, { kind: "multi-select" }>;
  disabled: boolean;
}) {
  const [query, setQuery] = useState("");
  if (!row.searchable) return <OptionGrid row={row} disabled={disabled} />;
  const needle = query.trim().toLowerCase();
  const matches = needle
    ? row.options.filter((option) =>
        option.label.toLowerCase().includes(needle),
      )
    : row.options;
  const selected = row.binding.value.flatMap((value) =>
    row.options.filter((option) => option.value === value),
  );
  const options = [
    ...selected,
    ...matches.filter((option) => !row.binding.value.includes(option.value)),
  ];
  return (
    <div className="grid gap-3">
      <span {...settingsTags(row.id, "settings.row.control")}>
        <TextField
          type="search"
          {...optional("id", row.controlId)}
          aria-label={controlName(row)}
          {...optional(
            "placeholder",
            row.binding.value.length === 0
              ? (row.emptyValueLabel ?? row.placeholder)
              : row.placeholder,
          )}
          value={query}
          disabled={disabled}
          onChange={setQuery}
        />
      </span>
      {options.length === 0 ? (
        <p className="text-sm text-muted-foreground">{row.emptyLabel}</p>
      ) : (
        <OptionGrid row={row} disabled={disabled} options={options} />
      )}
    </div>
  );
}

function HouseAction({
  rid,
  part,
  action,
  ridKey,
  compact,
  controlId,
  accessibleLabel,
}: {
  controlId?: string;
  accessibleLabel?: string | undefined;
  rid: string;
  part: string;
  action: SettingsRowAction;
  ridKey?: string;
  compact?: boolean;
}) {
  const state = useSettingsAction(action);
  const trigger = action.trigger;
  // A navigate trigger is an in-app link. Leaving the anchor to the browser sends
  // it to the origin root: these hrefs are written from the mounted route (for
  // example /settings/app-automations/setup), while the app is served under a
  // base path (/meeting-notes-2, /dispatch/...), so the browser lands on a page
  // the app does not have (11-13: Settings → Automations → New automation opened
  // the host's "Page not found" instead of the rule form). The router prefixes
  // its basename, exactly as the whole-row link does above.
  const routerNavigate = useRouterNavigate();
  if (action.condition?.visible === false) return null;
  if (state.href !== undefined) {
    return (
      <a
        {...settingsTags(rid, part, ridKey)}
        href={state.href}
        aria-label={action.accessibleLabel}
        target={state.external ? "_blank" : undefined}
        rel={state.external ? "noreferrer" : undefined}
        aria-disabled={state.disabled || undefined}
        onClick={(event) => {
          if (state.disabled) event.preventDefault();
          else if (!state.external) routerNavigate(event, state.href as string);
        }}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground underline-offset-4 hover:underline"
      >
        {action.icon}
        {action.label}
      </a>
    );
  }
  const dialogTags = settingsTags(`${rid}.dialog`, "settings.dialog", ridKey);
  const Body = trigger.kind === "dialog" ? trigger.body : undefined;
  return (
    <>
      <span {...settingsTags(rid, part, ridKey)} className="contents">
        <ActionButton
          size={compact ? "compact" : "default"}
          emphasis={compact ? "ghost" : "outline"}
          intent={action.intent ?? "neutral"}
          {...optional("id", controlId)}
          {...optional("aria-label", accessibleLabel ?? action.accessibleLabel)}
          {...optional("aria-pressed", action.active)}
          {...optional(
            "aria-expanded",
            trigger.kind === "dialog" && !trigger.body ? state.open : undefined,
          )}
          {...optional<"aria-haspopup", "dialog">(
            "aria-haspopup",
            trigger.kind === "dialog" || trigger.kind === "confirm"
              ? "dialog"
              : undefined,
          )}
          {...optional("pending", action.pending || state.running)}
          {...optional("disabled", state.disabled)}
          {...optional("title", action.condition?.disabledReason)}
          {...optional("leadingIcon", action.icon)}
          onPress={state.activate}
        >
          {action.label}
        </ActionButton>
      </span>
      {action.error && part !== "settings.row.control" ? (
        <span
          role="alert"
          {...settingsTags(rid, "settings.row.error", ridKey)}
          className="text-xs text-destructive"
        >
          {action.error}
        </span>
      ) : null}
      {trigger.kind === "dialog" && trigger.chrome === "body" && Body ? (
        state.open ? (
          <Body close={() => state.setOpen(false)} tags={dialogTags} />
        ) : null
      ) : trigger.kind === "dialog" ? (
        <Dialog
          open={state.open}
          onOpenChange={state.setOpen}
          title={trigger.title}
          description={trigger.description}
        >
          {Body ? (
            <Body close={() => state.setOpen(false)} tags={dialogTags} />
          ) : (
            <span {...dialogTags} />
          )}
        </Dialog>
      ) : null}
      {trigger.kind === "confirm" ? (
        <Dialog
          open={state.open}
          onOpenChange={state.setOpen}
          title={trigger.title}
          description={trigger.description}
          size="small"
          footer={
            <>
              <span
                {...settingsTags(
                  `${rid}.dialog.cancel`,
                  "settings.dialog.action",
                  ridKey,
                )}
                className="contents"
              >
                <ActionButton
                  emphasis="outline"
                  onPress={() => state.setOpen(false)}
                >
                  {trigger.cancelLabel}
                </ActionButton>
              </span>
              <span
                {...settingsTags(
                  `${rid}.dialog.confirm`,
                  "settings.dialog.action",
                  ridKey,
                )}
                className="contents"
              >
                <ActionButton
                  intent={action.intent === "danger" ? "danger" : "primary"}
                  pending={state.running}
                  onPress={() => void state.confirm()}
                >
                  {trigger.confirmLabel}
                </ActionButton>
              </span>
            </>
          }
        >
          <span {...dialogTags} />
          {state.confirmError ? (
            <p role="alert" className="text-sm text-destructive">
              {state.confirmError}
            </p>
          ) : null}
        </Dialog>
      ) : null}
    </>
  );
}

const STATUS_TONE = {
  neutral: "bg-muted text-muted-foreground",
  success: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  warning: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  danger: "bg-destructive/15 text-destructive",
} as const;

function CellText({
  rid,
  label,
  binding,
}: {
  rid: string;
  label: string;
  binding: SettingsBinding<string>;
}) {
  const write = useBindingWrite(rid);
  const [draft, setDraft] = useState<string | null>(null);
  // A failed write keeps the draft, so the user can retry without retyping.
  const flush = () => {
    if (draft === null) return;
    if (draft === binding.value) {
      setDraft(null);
      return;
    }
    void write(binding, draft).then((saved) => {
      if (saved) setDraft((current) => (current === draft ? null : current));
    });
  };
  return (
    <TextField
      aria-label={label}
      value={draft ?? binding.value}
      disabled={!binding.set || binding.pending === true}
      onChange={setDraft}
      onBlur={flush}
      onKeyDown={(event) => {
        if (event.key === "Enter") flush();
      }}
    />
  );
}

function CollectionCell({
  rid,
  itemKey,
  column,
  cell,
  muted,
}: {
  rid: string;
  itemKey: string;
  column: string;
  cell: SettingsCollectionCell;
  muted: boolean;
}) {
  const write = useBindingWrite(rid);
  if (typeof cell === "string") {
    return (
      <span
        className={cn(
          "text-sm",
          muted ? "text-muted-foreground" : "text-foreground",
        )}
      >
        {cell}
      </span>
    );
  }
  if (cell.kind === "value") {
    return (
      <span
        title={cell.tooltip}
        className={cn(
          "text-sm",
          cell.tone === "danger"
            ? "text-destructive"
            : cell.tone === "warning"
              ? "text-amber-700 dark:text-amber-400"
              : cell.tone === "default"
                ? "text-foreground"
                : "text-muted-foreground",
        )}
      >
        {cell.value}
      </span>
    );
  }
  if (cell.kind === "status") {
    return (
      <span
        className={cn(
          "rounded-full px-2 py-0.5 text-xs font-medium",
          STATUS_TONE[cell.tone],
        )}
      >
        {cell.label}
      </span>
    );
  }
  const tags = settingsTags(
    `${rid}.item.${column}`,
    "settings.collection.control",
    itemKey,
  );
  const locked = !cell.binding.set || cell.binding.pending === true;
  if (cell.kind === "toggle" || cell.kind === "checkbox") {
    const Control = cell.kind === "toggle" ? Switch : Checkbox;
    return (
      <span {...tags} className="contents">
        <Control
          aria-label={cell.label}
          checked={cell.binding.value}
          disabled={locked}
          onChange={(checked) => void write(cell.binding, checked)}
        />
      </span>
    );
  }
  if (cell.kind === "text") {
    return (
      <span {...tags} className="contents">
        <CellText rid={rid} label={cell.label} binding={cell.binding} />
      </span>
    );
  }
  if (!isPickerCell(cell)) return null;
  return (
    <span {...tags} className="contents">
      <Picker
        mode="select"
        aria-label={cell.label}
        value={cell.binding.value}
        disabled={locked}
        options={cell.options.map((option) => ({
          value: option.value,
          label: option.label,
          icon: option.icon,
          ...optional("disabled", option.disabled),
        }))}
        onChange={(value) => {
          if (value !== null) void write(cell.binding, value);
        }}
      />
    </span>
  );
}

function CollectionItemRow({
  rid,
  item,
  columns,
}: {
  rid: string;
  item: SettingsCollectionItem;
  columns: readonly SettingsCollectionColumn[];
}) {
  const title = (
    <span className="min-w-0">
      {item.rename ? (
        <span
          {...settingsTags(
            `${rid}.item.rename`,
            "settings.collection.control",
            item.key,
          )}
          className="contents"
        >
          <CellText
            rid={rid}
            label={item.rename.label}
            binding={item.rename.binding}
          />
        </span>
      ) : (
        <span
          className={cn(
            "block truncate text-sm font-medium",
            item.tone === "muted" ? "text-muted-foreground" : "text-foreground",
          )}
        >
          {item.title}
        </span>
      )}
      {item.description ? (
        <span className="block truncate text-xs text-muted-foreground">
          {item.description}
        </span>
      ) : null}
    </span>
  );
  return (
    <li
      {...item.attributes}
      {...settingsTags(`${rid}.item`, "settings.collection.item", item.key)}
      title={item.titleTooltip}
      className="flex items-center gap-3 px-5 py-3"
    >
      {item.leading ? <span className="shrink-0">{item.leading}</span> : null}
      {item.href ? (
        <a href={item.href} className="min-w-0 flex-1 hover:underline">
          {title}
        </a>
      ) : (
        <span className="min-w-0 flex-1">{title}</span>
      )}
      {item.badges?.map((badge) => {
        const label = typeof badge === "string" ? badge : badge.label;
        return (
          <span
            key={label}
            {...(typeof badge === "string" ? undefined : badge.attributes)}
            className={cn(
              "rounded-full px-2 py-0.5 text-xs",
              typeof badge === "string"
                ? "bg-muted text-muted-foreground"
                : STATUS_TONE[badge.tone],
            )}
          >
            {label}
          </span>
        );
      })}
      {columns.map((column) => {
        const cell = item.cells?.[column.id];
        return cell !== undefined ? (
          <span
            key={column.id}
            style={column.width ? { width: column.width } : undefined}
            className={cn(
              "shrink-0",
              column.hideBelow === "sm" && "hidden sm:block",
              column.hideBelow === "md" && "hidden md:block",
              column.hideBelow === "lg" && "hidden lg:block",
            )}
          >
            <CollectionCell
              rid={rid}
              itemKey={item.key}
              column={column.id}
              cell={cell}
              muted={column.tone !== "default"}
            />
          </span>
        ) : null;
      })}
      {item.actions?.map((action) => (
        <HouseAction
          key={action.id}
          rid={`${rid}.item.${action.id}`}
          part="settings.collection.action"
          ridKey={item.key}
          action={action}
          compact
        />
      ))}
    </li>
  );
}

function fieldLabel(field: { label: string; labelSuffix?: string }) {
  return field.labelSuffix
    ? `${field.label} ${field.labelSuffix}`
    : field.label;
}

function CollectionAddForm({
  rid,
  add,
}: {
  rid: string;
  add: Extract<SettingsCollectionAdd, { kind: "fields" }>;
}) {
  const [open, setOpen] = useState(false);
  const form = useSettingsCollectionAdd(add);
  const close = () => {
    setOpen(false);
    form.reset();
  };
  return (
    <>
      <span
        {...settingsTags(`${rid}.add`, "settings.collection.add")}
        className="contents"
      >
        <ActionButton
          size="compact"
          emphasis="outline"
          onPress={() => setOpen(true)}
        >
          {add.label}
        </ActionButton>
      </span>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (form.submitting) return;
          if (next) setOpen(true);
          else close();
        }}
        title={add.title ?? add.label}
        description={add.description}
        closeDisabled={form.submitting}
        size="small"
        footer={
          <>
            {add.cancelLabel ? (
              <span
                {...settingsTags(`${rid}.add.cancel`, "settings.dialog.action")}
                className="contents"
              >
                <ActionButton
                  emphasis="outline"
                  disabled={form.submitting}
                  onPress={close}
                >
                  {add.cancelLabel}
                </ActionButton>
              </span>
            ) : null}
            <span
              {...settingsTags(`${rid}.add.submit`, "settings.dialog.action")}
              className="contents"
            >
              <ActionButton
                intent="primary"
                pending={form.submitting}
                disabled={!form.canSubmit}
                onPress={() =>
                  void form.submit().then((saved) => {
                    if (saved) setOpen(false);
                  })
                }
              >
                {add.submitLabel}
              </ActionButton>
            </span>
          </>
        }
      >
        <div className="grid gap-3">
          {add.fields.map((field) => {
            const tags = settingsTags(
              `${rid}.add.${field.id}`,
              "settings.collection.field",
            );
            const value = form.values[field.id];
            const locked = Boolean(
              form.fieldsDisabled ||
              field.condition?.disabled ||
              field.condition?.disabledReason,
            );
            if (field.kind === "checkbox") {
              return (
                <span key={field.id} {...tags}>
                  <Checkbox
                    {...optional("id", field.controlId)}
                    disabled={locked}
                    label={fieldLabel(field)}
                    {...optional("description", field.description)}
                    checked={value === true}
                    onChange={(checked) => form.set(field.id, checked)}
                  />
                </span>
              );
            }
            if (field.kind === "select" || field.kind === "color") {
              return (
                <span key={field.id} {...tags}>
                  <Picker
                    mode="select"
                    {...optional("id", field.controlId)}
                    disabled={locked}
                    label={fieldLabel(field)}
                    {...optional("description", field.description)}
                    value={typeof value === "string" && value ? value : null}
                    options={field.options.map((option) => ({
                      value: option.value,
                      label: option.label,
                      icon: option.icon,
                    }))}
                    onChange={(next) => form.set(field.id, next ?? "")}
                  />
                </span>
              );
            }
            if (field.kind === "image") {
              return (
                <label
                  key={field.id}
                  {...tags}
                  className="grid gap-1.5 text-sm"
                >
                  <span className="font-medium text-foreground">
                    {field.buttonLabel ?? field.label}
                  </span>
                  <Input
                    id={field.controlId}
                    disabled={locked}
                    type="file"
                    aria-label={fieldLabel(field)}
                    accept={field.accept ?? "image/*"}
                    onChange={(event) =>
                      form.set(field.id, event.currentTarget.files?.[0] ?? null)
                    }
                  />
                </label>
              );
            }
            if (!isTextField(field)) return null;
            if (field.kind === "textarea") {
              return (
                <span key={field.id} {...tags}>
                  <TextArea
                    {...optional("id", field.controlId)}
                    disabled={locked}
                    label={fieldLabel(field)}
                    {...optional("description", field.description)}
                    {...optional("placeholder", field.placeholder)}
                    {...optional("maxLength", field.maxLength)}
                    value={typeof value === "string" ? value : ""}
                    onChange={(next) => form.set(field.id, next)}
                  />
                </span>
              );
            }
            return (
              <span key={field.id} {...tags}>
                <TextField
                  {...optional("id", field.controlId)}
                  disabled={locked}
                  label={fieldLabel(field)}
                  {...optional("description", field.description)}
                  {...optional("placeholder", field.placeholder)}
                  value={typeof value === "string" ? value : ""}
                  onChange={(next) =>
                    form.set(
                      field.id,
                      field.maxLength === undefined
                        ? next
                        : next.slice(0, field.maxLength),
                    )
                  }
                />
              </span>
            );
          })}
          {form.error ? (
            <p
              role="alert"
              {...settingsTags(`${rid}.add.error`, "settings.collection.error")}
              className="text-sm text-destructive"
            >
              {form.error}
            </p>
          ) : null}
        </div>
      </Dialog>
    </>
  );
}

function isPickerCell(
  cell: Exclude<SettingsCollectionCell, string>,
): cell is Extract<SettingsCollectionCell, { kind: "select" | "color" }> {
  return cell.kind === "select" || cell.kind === "color";
}

function isTextField(
  field: SettingsCollectionField,
): field is Extract<SettingsCollectionField, { kind: "text" | "textarea" }> {
  return field.kind === "text" || field.kind === "textarea";
}

function groupItems(items: readonly SettingsCollectionItem[]): {
  id: string | undefined;
  group: string | undefined;
  items: SettingsCollectionItem[];
}[] {
  const groups: {
    id: string | undefined;
    group: string | undefined;
    items: SettingsCollectionItem[];
  }[] = [];
  for (const item of items) {
    const last = groups.at(-1);
    const id = typeof item.group === "string" ? item.group : item.group?.id;
    const label =
      typeof item.group === "string" ? item.group : item.group?.label;
    if (last && last.id === id) last.items.push(item);
    else groups.push({ id, group: label, items: [item] });
  }
  return groups;
}

function HouseCollection({
  row,
}: {
  row: Extract<SettingsRowDefinition, { kind: "collection" }>;
}) {
  const columns = row.columns ?? [];
  const items = row.items;
  const add = row.add;
  const sortable = columns.filter((column) => column.sort !== undefined);
  return (
    <RowFrame
      row={row}
      control={
        add?.kind === "fields" ? (
          <CollectionAddForm rid={row.id} add={add} />
        ) : add?.kind === "trigger" ? (
          <HouseAction
            rid={`${row.id}.add`}
            part="settings.collection.add"
            action={add.action}
            compact
          />
        ) : undefined
      }
    >
      <div className="grid gap-3">
        {row.actions && row.actions.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            {row.actions.map((action) => (
              <HouseAction
                key={action.id}
                rid={`${row.id}.${action.id}`}
                part="settings.collection.header-action"
                action={action}
                compact
              />
            ))}
          </div>
        ) : null}
        {row.filter ? (
          <div
            role="radiogroup"
            aria-label={row.filter.label}
            {...settingsTags(`${row.id}.filter`, "settings.collection.filter")}
            className="inline-flex w-fit rounded-lg border border-border p-0.5"
          >
            {row.filter.options.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={row.filter?.value === option.value}
                {...settingsTags(
                  `${row.id}.filter.${option.value}`,
                  "settings.collection.filter-option",
                )}
                onClick={() => row.filter?.set(option.value)}
                className={cn(
                  "rounded-md px-3 py-1 text-sm",
                  row.filter?.value === option.value
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        ) : null}
        {row.search ? (
          <span
            {...settingsTags(`${row.id}.search`, "settings.collection.search")}
          >
            <TextField
              type="search"
              aria-label={row.search.label}
              placeholder={row.search.label}
              value={row.search.value}
              {...optional("inputRef", row.search.inputRef)}
              onChange={row.search.set}
              {...optional("onKeyDown", row.search.onKeyDown)}
              {...optional(
                "trailingContent",
                row.search.submit ? (
                  <span
                    {...settingsTags(
                      `${row.id}.search.submit`,
                      "settings.collection.add",
                    )}
                    className="contents"
                  >
                    <ActionButton
                      size="compact"
                      emphasis="outline"
                      {...optional("disabled", row.search.submit.disabled)}
                      onPress={() => void row.search?.submit?.run()}
                    >
                      {row.search.submit.label}
                    </ActionButton>
                  </span>
                ) : undefined,
              )}
            />
          </span>
        ) : null}
        {sortable.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            {sortable.map((column) => (
              <span
                key={column.id}
                {...settingsTags(
                  `${row.id}.sort.${column.id}`,
                  "settings.collection.sort",
                )}
                className="contents"
              >
                <ActionButton
                  size="compact"
                  emphasis="ghost"
                  aria-pressed={column.sort !== "none"}
                  trailingIcon={
                    column.sort === "ascending" ? (
                      <IconArrowUp aria-hidden className="size-3.5" />
                    ) : column.sort === "descending" ? (
                      <IconArrowDown aria-hidden className="size-3.5" />
                    ) : undefined
                  }
                  onPress={() => row.onSort?.(column.id)}
                >
                  {column.label}
                </ActionButton>
              </span>
            ))}
          </div>
        ) : null}
        {items.status === "loading" ? (
          <div role="status" aria-label={items.label} className="grid gap-2">
            <Skeleton height={20} />
            <Skeleton height={20} />
          </div>
        ) : items.status === "error" ? (
          <div role="alert" className="grid gap-1 text-sm text-destructive">
            {items.title ? (
              <span className="font-medium">{items.title}</span>
            ) : null}
            <span>{items.message}</span>
            {items.retry && items.retryLabel ? (
              <span>
                <ActionButton
                  size="compact"
                  emphasis="outline"
                  onPress={items.retry}
                >
                  {items.retryLabel}
                </ActionButton>
              </span>
            ) : null}
          </div>
        ) : items.value.length === 0 ? (
          row.emptyLabel === undefined ? null : (
            <p
              {...settingsTags(`${row.id}.empty`, "settings.collection.empty")}
              className="text-sm text-muted-foreground"
            >
              {row.emptyLabel}
            </p>
          )
        ) : (
          groupItems(items.value).map((group, index) => (
            <div key={group.id ?? index} className="grid gap-1.5">
              {group.group ? (
                <h3 className="text-xs font-medium text-muted-foreground">
                  {group.group}
                </h3>
              ) : null}
              <ul className="overflow-hidden rounded-lg border border-border/70 divide-y divide-border/60">
                {group.items.map((item) => (
                  <CollectionItemRow
                    key={item.key}
                    rid={row.id}
                    item={item}
                    columns={columns}
                  />
                ))}
              </ul>
            </div>
          ))
        )}
        {row.footer ? (
          <p className="text-xs text-muted-foreground">{row.footer}</p>
        ) : null}
        {row.paging ? (
          <div className="flex items-center justify-end gap-2">
            {row.paging.label ? (
              <span className="text-xs text-muted-foreground">
                {row.paging.label}
              </span>
            ) : null}
            <span
              {...settingsTags(
                `${row.id}.previous`,
                "settings.collection.paging",
              )}
              className="contents"
            >
              <ActionButton
                size="compact"
                emphasis="outline"
                disabled={!row.paging.previous}
                onPress={() => row.paging?.previous?.()}
              >
                {row.paging.previousLabel}
              </ActionButton>
            </span>
            <span
              {...settingsTags(`${row.id}.next`, "settings.collection.paging")}
              className="contents"
            >
              <ActionButton
                size="compact"
                emphasis="outline"
                disabled={!row.paging.next}
                onPress={() => row.paging?.next?.()}
              >
                {row.paging.nextLabel}
              </ActionButton>
            </span>
          </div>
        ) : null}
      </div>
    </RowFrame>
  );
}
