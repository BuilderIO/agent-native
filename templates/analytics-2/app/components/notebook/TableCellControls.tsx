import { useT } from "@agent-native/core/client/i18n";
import {
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconFilter,
  IconX,
} from "@tabler/icons-react";
import { useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import type { CellOutput } from "@/lib/model/contracts";

import { pivotAggregationSchema } from "../../../shared/pivot-config";
import {
  tableFormatSchema,
  type TableColumnPreference,
  type TableConfig,
  type TableFilter,
} from "../../../shared/table-visualization-config";
import {
  makeTableFilter,
  TABLE_FILTER_LABELS,
  tableFilterOperators,
  tableFilterText,
  type TableColumn,
} from "./table-cell-display";

type Update = (patch: Partial<TableConfig>) => void;
type Editor = "rename" | "filter" | "format" | "totals" | "conditional";

const EDITOR_LABELS = {
  rename: "notebook.renameColumn",
  filter: "notebook.filterThisColumn",
  format: "notebook.formatColumnAction",
  totals: "notebook.tableCell.addTotal",
  conditional: "notebook.tableCell.conditionalFormatting",
} as const;
const FORMAT_LABELS = {
  default: "notebook.formatDefault",
  number: "notebook.formatNumber",
  percent: "notebook.formatPercent",
} as const;

function columnPatch(
  config: TableConfig,
  column: TableColumn,
  patch: TableColumnPreference,
): Partial<TableConfig> {
  return {
    columns: {
      ...config.columns,
      [column.field.fieldId]: { ...column.settings, ...patch },
    },
  };
}

export function TableColumnMenu({
  column,
  config,
  update,
  disabled,
}: {
  column: TableColumn;
  config: TableConfig;
  update: Update;
  disabled: boolean;
}) {
  const t = useT();
  const [editor, setEditor] = useState<Editor>();
  const [copyFailed, setCopyFailed] = useState(false);
  const { field, settings } = column;
  const numeric = isNumeric(column);
  const date = field.type === "date" || field.type === "datetime";
  const sortAsc = numeric
    ? "notebook.sortNumberAsc"
    : date
      ? "notebook.sortDateAsc"
      : field.type === "boolean"
        ? "notebook.sortBooleanAsc"
        : "notebook.sortStringAsc";
  const sortDesc = numeric
    ? "notebook.sortNumberDesc"
    : date
      ? "notebook.sortDateDesc"
      : field.type === "boolean"
        ? "notebook.sortBooleanDesc"
        : "notebook.sortStringDesc";

  async function copy() {
    try {
      await navigator.clipboard.writeText(column.label);
      setCopyFailed(false);
    } catch {
      setCopyFailed(true);
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label={t("notebook.columnOptions", { column: column.label })}
            disabled={disabled}
          >
            <IconChevronDown size={14} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onSelect={() => setEditor("rename")}>
            {t(EDITOR_LABELS.rename)}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void copy()}>
            {t("notebook.copyColumnName")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() =>
              update({ sort: { fieldId: field.fieldId, direction: "asc" } })
            }
          >
            {t(sortAsc)}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() =>
              update({ sort: { fieldId: field.fieldId, direction: "desc" } })
            }
          >
            {t(sortDesc)}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => setEditor("filter")}
            disabled={config.filters.length >= 32}
          >
            {t(EDITOR_LABELS.filter)}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setEditor("totals")}>
            {t(EDITOR_LABELS.totals)}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => setEditor("format")}
            disabled={!numeric}
          >
            {t(EDITOR_LABELS.format)}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setEditor("conditional")}>
            {t(EDITOR_LABELS.conditional)}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() =>
              update(columnPatch(config, column, { hidden: true }))
            }
          >
            {t("notebook.hideColumn")}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() =>
              update(columnPatch(config, column, { pinned: !settings?.pinned }))
            }
          >
            {t(
              settings?.pinned ? "notebook.unpinColumn" : "notebook.pinColumn",
            )}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {editor ? (
        <FieldEditor
          mode={editor}
          column={column}
          config={config}
          update={update}
          onClose={() => setEditor(undefined)}
        />
      ) : null}
      {copyFailed ? (
        <span role="alert" className="sr-only">
          {t("notebook.dataCopyFailed")}
        </span>
      ) : null}
    </>
  );
}

function isNumeric({ field }: TableColumn) {
  return (
    field.type === "number" ||
    field.type === "integer" ||
    field.type === "decimal"
  );
}

export function TableFilterMenu({
  columns,
  config,
  update,
  disabled,
}: {
  columns: TableColumn[];
  config: TableConfig;
  update: Update;
  disabled: boolean;
}) {
  const t = useT();
  const [column, setColumn] = useState<TableColumn>();
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="xs"
            variant="ghost"
            disabled={
              disabled || !columns.length || config.filters.length >= 32
            }
          >
            <IconFilter size={14} />
            {t("notebook.resultFilters")}
            {config.filters.length ? (
              <span>{config.filters.length}</span>
            ) : null}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {columns.map((item) => (
            <DropdownMenuItem
              key={item.field.fieldId}
              onSelect={() => setColumn(item)}
            >
              {item.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {column ? (
        <FieldEditor
          mode="filter"
          column={column}
          config={config}
          update={update}
          onClose={() => setColumn(undefined)}
        />
      ) : null}
    </>
  );
}

export function TableCellControls({
  columns,
  config,
  update,
  disabled,
}: {
  columns: TableColumn[];
  config: TableConfig;
  update: Update;
  disabled: boolean;
}) {
  const t = useT();
  const [editor, setEditor] = useState<{ mode: Editor; column: TableColumn }>();
  const [search, setSearch] = useState("");
  const [width, setWidth] = useState<string>();
  const view = config.view;
  const editView = (patch: Partial<TableConfig["view"]>) =>
    update({ view: { ...view, ...patch } });
  function move(index: number, direction: number) {
    const order = columns.map(({ field }) => field.fieldId);
    const field = order[index];
    if (field === undefined) return;
    order.splice(index, 1);
    order.splice(index + direction, 0, field);
    update({ columnOrder: order });
  }
  return (
    <>
      <FooterPopover label={t("notebook.resultView")} disabled={disabled}>
        <label className="flex items-center gap-2">
          <span className="flex-1">
            {t("notebook.tableCell.setColumnWidth")}
          </span>
          <Input
            className="h-7 w-20"
            type="number"
            min={60}
            max={500}
            value={width ?? view.columnWidth ?? ""}
            onChange={(event) => setWidth(event.target.value)}
            onBlur={(event) => {
              const text = event.target.value;
              setWidth(undefined);
              const value = text === "" ? null : Number(text);
              if (
                value !== view.columnWidth &&
                (value === null ||
                  (Number.isInteger(value) && value >= 60 && value <= 500))
              )
                editView({ columnWidth: value });
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
          />
        </label>
        <div className="flex justify-between gap-2">
          <span>{t("notebook.rowsPerPage")}</span>
          <span>50</span>
        </div>
        <Check
          label={t("notebook.tableCell.showRowNumber")}
          checked={view.rowNumbers}
          onChange={(rowNumbers) => editView({ rowNumbers })}
          disabled={disabled}
        />
        <Check
          label={t("notebook.tableCell.pinRowNumber")}
          checked={view.rowNumbersPinned}
          onChange={(rowNumbersPinned) => editView({ rowNumbersPinned })}
          disabled={disabled || !view.rowNumbers}
        />
        <Check
          label={t("notebook.tableCell.showDatatypeIcons")}
          checked={view.typeIcons}
          onChange={(typeIcons) => editView({ typeIcons })}
          disabled={disabled}
        />
      </FooterPopover>
      <FooterPopover
        label={t("notebook.resultFormat")}
        disabled={disabled || !columns.length}
      >
        {columns.map((column) => (
          <div className="flex items-center gap-1" key={column.field.fieldId}>
            <Button
              className="min-w-0 flex-1 justify-start truncate"
              size="sm"
              variant="ghost"
              disabled={disabled || !isNumeric(column)}
              onClick={() => setEditor({ mode: "format", column })}
            >
              {column.label}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={disabled}
              onClick={() => setEditor({ mode: "conditional", column })}
            >
              {t(EDITOR_LABELS.conditional)}
            </Button>
          </div>
        ))}
      </FooterPopover>
      <FooterPopover
        label={t("notebook.resultColumns")}
        disabled={disabled || !columns.length}
      >
        <Input
          aria-label={t("notebook.tableCell.searchColumns")}
          placeholder={t("notebook.tableCell.searchColumns")}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        {columns.map((column, index) => {
          if (
            !column.label
              .toLocaleLowerCase()
              .includes(search.trim().toLocaleLowerCase())
          )
            return null;
          return (
            <div className="flex items-center gap-1" key={column.field.fieldId}>
              <span className="min-w-0 flex-1 truncate">
                <Check
                  label={column.label}
                  checked={!column.settings?.hidden}
                  onChange={(shown) =>
                    update(columnPatch(config, column, { hidden: !shown }))
                  }
                  disabled={disabled}
                />
              </span>
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label={t("notebook.moveColumnLeft")}
                disabled={disabled || index === 0}
                onClick={() => move(index, -1)}
              >
                <IconChevronLeft size={14} />
              </Button>
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label={t("notebook.moveColumnRight")}
                disabled={disabled || index === columns.length - 1}
                onClick={() => move(index, 1)}
              >
                <IconChevronRight size={14} />
              </Button>
            </div>
          );
        })}
      </FooterPopover>
      <FooterPopover
        label={t("notebook.resultTotals")}
        disabled={disabled || !columns.length}
      >
        {columns.map((column) => (
          <Button
            key={column.field.fieldId}
            className="justify-start truncate"
            size="sm"
            variant="ghost"
            disabled={disabled}
            onClick={() => setEditor({ mode: "totals", column })}
          >
            {column.label}
          </Button>
        ))}
      </FooterPopover>
      {editor ? (
        <FieldEditor
          mode={editor.mode}
          column={editor.column}
          config={config}
          update={update}
          onClose={() => setEditor(undefined)}
        />
      ) : null}
    </>
  );
}

type SqlOutput = Extract<CellOutput, { type: "table" }>;
type SqlResultFormat = "number" | "percent";

export type SqlResultDisplay = {
  rowNumbers: boolean;
  typeIcons: boolean;
  formats: Partial<Record<number, SqlResultFormat>>;
  hidden: Partial<Record<number, boolean>>;
};

export function SqlResultControls({
  columns,
  pageRows,
  display,
  update,
  disabled,
}: {
  columns: SqlOutput["columns"];
  pageRows: SqlOutput["rows"];
  display: SqlResultDisplay;
  update: (patch: Partial<SqlResultDisplay>) => void;
  disabled: boolean;
}) {
  const t = useT();
  return (
    <div className="flex flex-wrap gap-1 px-2 py-1">
      <FooterPopover label={t("notebook.resultView")} disabled={disabled}>
        <Check
          label={t("notebook.tableCell.showRowNumber")}
          checked={display.rowNumbers}
          onChange={(rowNumbers) => update({ rowNumbers })}
          disabled={disabled}
        />
        <Check
          label={t("notebook.tableCell.showDatatypeIcons")}
          checked={display.typeIcons}
          onChange={(typeIcons) => update({ typeIcons })}
          disabled={disabled}
        />
      </FooterPopover>
      <FooterPopover
        label={t("notebook.resultFormat")}
        disabled={disabled || columns.length === 0}
      >
        {columns.map(
          ({ name, type }, index) =>
            type === "number" && (
              <label
                className="flex items-center justify-between gap-2"
                key={index}
              >
                {name}
                <Select
                  value={display.formats[index] ?? "default"}
                  onValueChange={(value) => {
                    const formats = { ...display.formats };
                    if (value === "default") delete formats[index];
                    else if (value === "number" || value === "percent")
                      formats[index] = value;
                    update({ formats });
                  }}
                >
                  <SelectTrigger className="h-7 w-28" aria-label={name}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">
                      {t("notebook.formatDefault")}
                    </SelectItem>
                    <SelectItem value="number">
                      {t("notebook.formatNumber")}
                    </SelectItem>
                    <SelectItem value="percent">
                      {t("notebook.formatPercent")}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </label>
            ),
        )}
      </FooterPopover>
      <FooterPopover
        label={t("notebook.resultColumns")}
        disabled={disabled || columns.length === 0}
      >
        {columns.map(({ name }, index) => (
          <Check
            key={index}
            label={name}
            checked={!display.hidden[index]}
            onChange={(shown) =>
              update({ hidden: { ...display.hidden, [index]: !shown } })
            }
            disabled={disabled}
          />
        ))}
      </FooterPopover>
      <FooterPopover
        label={t("notebook.resultTotals")}
        disabled={disabled || pageRows.length === 0}
      >
        <div className="text-muted-foreground">
          {t("notebook.resultPageTotals")}
        </div>
        <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1">
          {columns.map(({ name, type }, index) => {
            if (type !== "number" || display.hidden[index]) return null;
            const values = pageRows.flatMap((row) =>
              row[index] == null ? [] : [row[index]],
            );
            const sum = values.every((value) => typeof value === "number")
              ? values.reduce((total, value) => total + value, 0)
              : null;
            return (
              <div key={index} className="contents">
                <dt>{name}</dt>
                <dd>{sum === null || !Number.isFinite(sum) ? "—" : sum}</dd>
              </div>
            );
          })}
        </dl>
      </FooterPopover>
    </div>
  );
}

function Check({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled: boolean;
}) {
  return (
    <label className="flex items-center gap-2">
      <Checkbox
        checked={checked}
        onCheckedChange={(value) => onChange(value === true)}
        disabled={disabled}
      />
      <span className="truncate">{label}</span>
    </label>
  );
}

function FooterPopover({
  label,
  children,
  disabled,
}: {
  label: string;
  children: ReactNode;
  disabled: boolean;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" size="xs" variant="ghost" disabled={disabled}>
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="grid max-h-72 w-auto max-w-[calc(100vw-2rem)] gap-2 overflow-auto p-2 text-sm"
        align="start"
      >
        {children}
      </PopoverContent>
    </Popover>
  );
}

function FieldEditor({
  mode,
  column,
  config,
  update,
  onClose,
}: {
  mode: Editor;
  column: TableColumn;
  config: TableConfig;
  update: Update;
  onClose: () => void;
}) {
  const t = useT();
  const { field, label } = column;
  const [name, setName] = useState(label);
  const [format, setFormat] = useState(column.settings?.format ?? "default");
  const [total, setTotal] = useState<TableConfig["totals"][string] | "none">(
    config.totals[field.fieldId] ?? "none",
  );
  const ops = tableFilterOperators(field);
  const [op, setOp] = useState<TableFilter["op"]>(ops[0] ?? "is-null");
  const [value, setValue] = useState(field.type === "boolean" ? "true" : "");
  const [choice, setChoice] = useState("");
  const [values, setValues] = useState<string[]>([]);
  const activeRules =
    mode === "conditional"
      ? config.formatRules.filter((rule) => rule.fieldId === field.fieldId)
      : [];
  const membership = op === "in" || op === "not-in";
  const hasValue = op !== "is-null" && op !== "is-not-null";
  const filtering = mode === "filter" || mode === "conditional";
  const filter =
    filtering && (value !== "" || membership || !hasValue)
      ? makeTableFilter(field, op, value, values)
      : undefined;
  const suggestions =
    mode === "filter" && (op === "eq" || op === "neq" || membership)
      ? column.choices.filter((item) =>
          item
            .toLocaleLowerCase()
            .includes((membership ? choice : value).toLocaleLowerCase()),
        )
      : [];
  const canSave =
    mode === "rename"
      ? name.trim() !== ""
      : mode === "filter"
        ? config.filters.length < 32 && filter !== undefined
        : mode === "conditional"
          ? config.formatRules.length < 32 && filter !== undefined
          : true;

  function commit() {
    if (!canSave) return;
    if (mode === "rename")
      update(columnPatch(config, column, { label: name.trim() }));
    if (mode === "format") update(columnPatch(config, column, { format }));
    if (mode === "totals") {
      const next = { ...config.totals };
      if (total === "none") delete next[field.fieldId];
      else next[field.fieldId] = total;
      update({ totals: next });
    }
    if (mode === "filter" && filter)
      update({ filters: [...config.filters, filter] });
    if (mode === "conditional" && filter)
      update({ formatRules: [...config.formatRules, filter] });
    onClose();
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            commit();
          }}
        >
          <DialogHeader>
            <DialogTitle>{t(EDITOR_LABELS[mode])}</DialogTitle>
          </DialogHeader>
          {mode === "rename" ? (
            <label className="grid gap-1 text-sm">
              {t("notebook.columnName")}
              <Input
                maxLength={200}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
          ) : null}
          {mode === "format" ? (
            <Select
              value={format}
              onValueChange={(item) => setFormat(tableFormatSchema.parse(item))}
            >
              <SelectTrigger aria-label={t("notebook.formatStyle")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {tableFormatSchema.options.map((item) => (
                  <SelectItem value={item} key={item}>
                    {t(FORMAT_LABELS[item])}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          {mode === "totals" ? (
            <Select
              value={total}
              onValueChange={(item) =>
                setTotal(
                  item === "none" ? item : pivotAggregationSchema.parse(item),
                )
              }
            >
              <SelectTrigger aria-label={t("notebook.resultTotals")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">
                  {t("notebook.tableCell.none")}
                </SelectItem>
                {pivotAggregationSchema.options
                  .filter(
                    (item) =>
                      isNumeric(column) ||
                      item === "count" ||
                      item === "count-distinct",
                  )
                  .map((item) => (
                    <SelectItem key={item} value={item}>
                      {t(`pivot.aggregations.${item}`)}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          ) : null}
          {filtering ? (
            <>
              {activeRules.map((rule, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between rounded bg-destructive/15 px-2 py-1 text-sm text-destructive"
                >
                  {tableFilterText(rule, label, t)}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={t("notebook.tableCell.removeRule")}
                    onClick={() => {
                      update({
                        formatRules: config.formatRules.filter(
                          (item) => item !== rule,
                        ),
                      });
                      onClose();
                    }}
                  >
                    <IconX size={14} />
                  </Button>
                </div>
              ))}
              <Select
                value={op}
                onValueChange={(item) => {
                  const next = ops.find((candidate) => candidate === item);
                  if (next) setOp(next);
                }}
              >
                <SelectTrigger
                  aria-label={t("notebook.displayFilters.operator", {
                    column: label,
                    index: 1,
                  })}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ops.map((item) => (
                    <SelectItem key={item} value={item}>
                      {t(
                        `notebook.displayFilters.operators.${TABLE_FILTER_LABELS[item]}`,
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {hasValue && !membership ? (
                field.type === "boolean" ? (
                  <Select value={value} onValueChange={setValue}>
                    <SelectTrigger aria-label={t("notebook.filterValue")}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="true">
                        {t("notebook.filterTrue")}
                      </SelectItem>
                      <SelectItem value="false">
                        {t("notebook.filterFalse")}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    aria-label={t("notebook.filterValue")}
                    type={field.type === "date" ? "date" : "text"}
                    value={value}
                    onChange={(event) => setValue(event.target.value)}
                    placeholder={
                      field.type === "string"
                        ? t("notebook.inputChoices.search")
                        : undefined
                    }
                    inputMode={isNumeric(column) ? "decimal" : undefined}
                  />
                )
              ) : null}
              {membership ? (
                <>
                  <div className="flex gap-2">
                    <Input
                      aria-label={t("notebook.filterValue")}
                      value={choice}
                      onChange={(event) => setChoice(event.target.value)}
                      placeholder={
                        field.type === "string"
                          ? t("notebook.inputChoices.search")
                          : undefined
                      }
                    />
                    <Button
                      type="button"
                      variant="outline"
                      disabled={
                        !choice.trim() ||
                        values.includes(choice) ||
                        values.length >= 200
                      }
                      onClick={() => {
                        setValues([...values, choice]);
                        setChoice("");
                      }}
                    >
                      {t("notebook.tableCell.addValue")}
                    </Button>
                  </div>
                  <div className="grid max-h-36 gap-1 overflow-auto text-sm">
                    {[...new Set([...values, ...suggestions])].map((item) => (
                      <Check
                        key={item}
                        label={item}
                        checked={values.includes(item)}
                        onChange={(checked) =>
                          setValues(
                            checked
                              ? [...values, item]
                              : values.filter((existing) => existing !== item),
                          )
                        }
                        disabled={
                          !values.includes(item) && values.length >= 200
                        }
                      />
                    ))}
                  </div>
                </>
              ) : null}
              {!membership && suggestions.length ? (
                <div className="grid max-h-36 gap-1 overflow-auto text-sm">
                  {suggestions.map((item) => (
                    <Button
                      className="justify-start truncate"
                      key={item}
                      type="button"
                      variant={value === item ? "secondary" : "ghost"}
                      aria-pressed={value === item}
                      size="sm"
                      onClick={() => setValue(item)}
                    >
                      {item}
                    </Button>
                  ))}
                </div>
              ) : null}
            </>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={!canSave}>
              {t("notebook.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
