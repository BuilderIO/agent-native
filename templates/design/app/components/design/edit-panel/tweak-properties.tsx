import type { TweakDefinition } from "@shared/api";

import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

import { ScrubInput } from "../inspector";
import {
  INSPECTOR_GRID_ACTION_GUTTER_SPAN,
  INSPECTOR_GRID_ACTION_PAIR_SPAN,
  INSPECTOR_GRID_ACTION_SPAN,
  INSPECTOR_GRID_COLUMNS,
  INSPECTOR_GRID_PAINT_FIELD_SPAN,
  InspectorGrid,
  InspectorGridCell,
} from "./inspector-grid";
import { ColorInput } from "./panel-primitives";

type TweakValue = string | number | boolean;
type TweakChange = (id: string, value: TweakValue) => void;

const SOLID_ONLY_PAINT_TYPES = ["solid" as const];

function isColorTweak(tweak: TweakDefinition) {
  return tweak.type === "color-swatch" || tweak.type === "color-swatches";
}

function stepPrecision(step: number | undefined) {
  if (!step || Number.isInteger(step)) return 0;
  const decimals = String(step).split(".")[1]?.length ?? 0;
  return Math.min(decimals, 4);
}

function numericTweakValue(tweak: TweakDefinition, value: TweakValue) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (Number.isFinite(parsed)) return parsed;
  const fallback = Number(tweak.defaultValue);
  return Number.isFinite(fallback) ? fallback : (tweak.min ?? 0);
}

function TweakLabel({ label }: { label: string }) {
  return (
    <p
      className="design-sidebar-field-label min-w-0 truncate text-muted-foreground"
      title={label}
    >
      {label}
    </p>
  );
}

function TweakScrubField({
  tweak,
  value,
  onChange,
}: {
  tweak: TweakDefinition;
  value: TweakValue;
  onChange: TweakChange;
}) {
  const unit =
    tweak.unit ??
    (tweak.cssVar?.toLowerCase().includes("radius") ? "px" : undefined);
  return (
    <ScrubInput
      label={tweak.label}
      ariaLabel={tweak.label}
      tooltipLabel={tweak.label}
      value={numericTweakValue(tweak, value)}
      onChange={(next) => onChange(tweak.id, next)}
      min={tweak.min ?? 0}
      max={tweak.max ?? 100}
      step={tweak.step ?? 1}
      {...(unit ? { unit } : {})}
      precision={stepPrecision(tweak.step)}
      className="w-full min-w-0 gap-0"
      labelClassName="h-6 w-7 justify-center gap-0 rounded-l-md rounded-r-none border border-r-0 border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] text-muted-foreground [&>span]:sr-only"
      inputClassName="h-6 min-w-0 rounded-l-none rounded-r-md border-[var(--design-editor-control-border)] border-l-0 bg-[var(--design-editor-control-bg)] px-0 text-left shadow-none focus-visible:ring-1 focus-visible:ring-[var(--design-editor-accent-color)]"
    />
  );
}

/** Up to two numeric tweaks laid out like Appearance's Opacity / Corner radius. */
function TweakSliderPair({
  tweaks,
  values,
  onChange,
}: {
  tweaks: [TweakDefinition] | [TweakDefinition, TweakDefinition];
  values: Record<string, TweakValue>;
  onChange: TweakChange;
}) {
  const [left, right] = tweaks;
  const valueOf = (tweak: TweakDefinition) =>
    values[tweak.id] ?? tweak.defaultValue;
  return (
    <InspectorGrid
      className="design-inspector-pair-fields items-center"
      layout="label-action-rows"
      data-tweak-row="slider"
    >
      <InspectorGridCell span={INSPECTOR_GRID_ACTION_PAIR_SPAN}>
        <TweakLabel label={left.label} />
      </InspectorGridCell>
      <InspectorGridCell span={INSPECTOR_GRID_ACTION_GUTTER_SPAN} ariaHidden />
      <InspectorGridCell span={INSPECTOR_GRID_ACTION_PAIR_SPAN}>
        {right ? <TweakLabel label={right.label} /> : null}
      </InspectorGridCell>
      <InspectorGridCell span={INSPECTOR_GRID_ACTION_GUTTER_SPAN} ariaHidden />
      <InspectorGridCell span={INSPECTOR_GRID_ACTION_SPAN} ariaHidden />
      <InspectorGridCell span={INSPECTOR_GRID_ACTION_PAIR_SPAN}>
        <TweakScrubField
          tweak={left}
          value={valueOf(left)}
          onChange={onChange}
        />
      </InspectorGridCell>
      <InspectorGridCell span={INSPECTOR_GRID_ACTION_GUTTER_SPAN} ariaHidden />
      <InspectorGridCell span={INSPECTOR_GRID_ACTION_PAIR_SPAN}>
        {right ? (
          <TweakScrubField
            tweak={right}
            value={valueOf(right)}
            onChange={onChange}
          />
        ) : null}
      </InspectorGridCell>
      <InspectorGridCell span={INSPECTOR_GRID_ACTION_GUTTER_SPAN} ariaHidden />
      <InspectorGridCell span={INSPECTOR_GRID_ACTION_SPAN} ariaHidden />
    </InspectorGrid>
  );
}

function TweakColorRow({
  tweak,
  value,
  onChange,
}: {
  tweak: TweakDefinition;
  value: TweakValue;
  onChange: TweakChange;
}) {
  return (
    <InspectorGrid
      className="design-inspector-pair-fields items-center"
      layout="label-field-action"
      data-tweak-row="color"
    >
      <InspectorGridCell span={INSPECTOR_GRID_COLUMNS}>
        <TweakLabel label={tweak.label} />
      </InspectorGridCell>
      <InspectorGridCell span={INSPECTOR_GRID_PAINT_FIELD_SPAN}>
        <ColorInput
          label={tweak.label}
          value={String(value)}
          onChange={(next) => onChange(tweak.id, next)}
          supportedPaintTypes={SOLID_ONLY_PAINT_TYPES}
          documentColors={(tweak.options ?? []).map(
            (option) => option.color ?? option.value,
          )}
        />
      </InspectorGridCell>
      <InspectorGridCell span={INSPECTOR_GRID_ACTION_SPAN} ariaHidden />
    </InspectorGrid>
  );
}

function TweakSelectRow({
  tweak,
  value,
  onChange,
}: {
  tweak: TweakDefinition;
  value: TweakValue;
  onChange: TweakChange;
}) {
  return (
    <InspectorGrid
      className="design-inspector-pair-fields items-center"
      layout="label-field-action"
      data-tweak-row="segment"
    >
      <InspectorGridCell span={INSPECTOR_GRID_COLUMNS}>
        <TweakLabel label={tweak.label} />
      </InspectorGridCell>
      <InspectorGridCell span={INSPECTOR_GRID_PAINT_FIELD_SPAN}>
        <Select
          value={String(value)}
          onValueChange={(next) => onChange(tweak.id, next)}
        >
          <SelectTrigger
            aria-label={tweak.label}
            className="h-6 w-full min-w-0 rounded-md border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] px-1.5 !text-[11px] shadow-none focus:ring-1 focus:ring-[var(--design-editor-accent-color)]"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(tweak.options ?? []).map((option) => (
              <SelectItem
                key={option.value}
                value={option.value}
                className="!text-[11px]"
              >
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </InspectorGridCell>
      <InspectorGridCell span={INSPECTOR_GRID_ACTION_SPAN} ariaHidden />
    </InspectorGrid>
  );
}

function TweakToggleRow({
  tweak,
  value,
  onChange,
}: {
  tweak: TweakDefinition;
  value: TweakValue;
  onChange: TweakChange;
}) {
  const switchId = `design-tweak-${tweak.id}`;
  return (
    <InspectorGrid
      className="items-center"
      layout="field-action"
      data-tweak-row="toggle"
    >
      <InspectorGridCell
        span={INSPECTOR_GRID_COLUMNS - INSPECTOR_GRID_ACTION_SPAN}
        className="flex h-6 items-center"
      >
        <Label
          htmlFor={switchId}
          className="design-sidebar-field-label min-w-0 truncate text-muted-foreground"
          title={tweak.label}
        >
          {tweak.label}
        </Label>
      </InspectorGridCell>
      <InspectorGridCell
        span={INSPECTOR_GRID_ACTION_SPAN}
        className="flex items-center justify-center"
      >
        <Switch
          id={switchId}
          size="sm"
          aria-label={tweak.label}
          checked={value === true || value === "true"}
          onCheckedChange={(checked) => onChange(tweak.id, checked)}
        />
      </InspectorGridCell>
    </InspectorGrid>
  );
}

type TweakRow =
  | {
      kind: "slider";
      tweaks: [TweakDefinition] | [TweakDefinition, TweakDefinition];
    }
  | { kind: "single"; tweak: TweakDefinition };

/** Consecutive numeric tweaks share a row two at a time, like X / Y. */
export function groupTweakRows(tweaks: TweakDefinition[]): TweakRow[] {
  const rows: TweakRow[] = [];
  let openPair: TweakDefinition | null = null;
  for (const tweak of tweaks) {
    if (tweak.type !== "slider") {
      openPair = null;
      rows.push({ kind: "single", tweak });
    } else if (openPair) {
      rows[rows.length - 1] = { kind: "slider", tweaks: [openPair, tweak] };
      openPair = null;
    } else {
      openPair = tweak;
      rows.push({ kind: "slider", tweaks: [tweak] });
    }
  }
  return rows;
}

export function TweakProperties({
  tweaks,
  values,
  onChange,
}: {
  tweaks: TweakDefinition[];
  values: Record<string, TweakValue>;
  onChange: TweakChange;
}) {
  return groupTweakRows(tweaks).map((row) => {
    if (row.kind === "slider") {
      return (
        <TweakSliderPair
          key={row.tweaks.map((tweak) => tweak.id).join("|")}
          tweaks={row.tweaks}
          values={values}
          onChange={onChange}
        />
      );
    }
    const { tweak } = row;
    const value = values[tweak.id] ?? tweak.defaultValue;
    if (isColorTweak(tweak)) {
      return (
        <TweakColorRow
          key={tweak.id}
          tweak={tweak}
          value={value}
          onChange={onChange}
        />
      );
    }
    if (tweak.type === "toggle") {
      return (
        <TweakToggleRow
          key={tweak.id}
          tweak={tweak}
          value={value}
          onChange={onChange}
        />
      );
    }
    return (
      <TweakSelectRow
        key={tweak.id}
        tweak={tweak}
        value={value}
        onChange={onChange}
      />
    );
  });
}
