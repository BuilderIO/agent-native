import { useDirection } from "@base-ui/react/direction-provider";
import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import {
  IconEye,
  IconEyeOff,
  IconDots,
  IconPlus,
  IconMinus,
} from "@tabler/icons-react";
import * as React from "react";

import { isComposingKey } from "../is-composing-key.js";
import { Badge } from "./badge.js";
import { Button, IconButton } from "./button.js";
import { indexedItem, requireItem } from "./indexed-item.js";
import { Input } from "./input.js";
import {
  InspectorSection,
  InspectorSectionHeader,
  InspectorContent,
} from "./inspector.js";
import {
  PropertyNumber,
  type PropertyNumberProps,
  type PropertyEdit,
} from "./layout-properties.js";
import { Menu, MenuTrigger, MenuPopup, MenuItem } from "./menu.js";
import { observeFieldsetDisabled } from "./observe-fieldset-disabled.js";
import {
  paintColor,
  paintBackground,
  type Paint,
  type PaintStop,
  type PaintToken,
  type PaintColor,
} from "./paint-model.js";
import {
  Popover,
  PopoverTrigger,
  PopoverPopup,
  PopoverTitle,
} from "./popover.js";
import { PropertyTokenField, useTokenBinding } from "./property-token.js";
import { Slider, SliderControl, SliderTrack, SliderThumb } from "./slider.js";

export { equalPaintStacks, createPaintStackEdit } from "./paint-model.js";

export {
  paintColor,
  paintBackground,
  type Paint,
  type PaintColor,
  type PaintToken,
  type PaintStop,
};
type Phase = "preview" | "commit";
type Container = React.ComponentProps<typeof PopoverPopup>["container"];
type Change<T> = (value: T, phase: Phase) => void;

const english = {
  fill: "Fill",
  add: "Add fill",
  solid: "Solid",
  linear: "Linear gradient",
  color: "Color",
  token: "Color token",
  literal: "Custom color",
  detachToken: "Detach",
  opacity: "Opacity",
  angle: "Angle",
  addStop: "Add stop",
  removeStop: "Remove stop",
  position: "Stop position",
  invalid: "Enter a CSS color.",
  missingToken: "Unavailable token",
  actions: "Paint actions",
  moveUp: "Move up",
  moveDown: "Move down",
  remove: "Remove fill",
  show: "Show",
  hide: "Hide",
  edit: "Edit",
  layer: (label: string, index: number) => `${label} ${index + 1}`,
  stop: (index: number) => `Stop ${index + 1}`,
};
export type PaintEditorLabels = typeof english;
const noTokens: readonly PaintToken[] = [];

/** An ordered list of paints, topmost first. */
export function PaintList({
  render,
  ...props
}: useRender.ComponentProps<"ol">) {
  return useRender({
    defaultTagName: "ol",
    render,
    props: mergeProps<"ol">({ className: "paint-editor-list" }, props),
  });
}

/** Place an edit trigger, visibility control and an action slot in each row. */
export function PaintRow({ render, ...props }: useRender.ComponentProps<"li">) {
  return useRender({
    defaultTagName: "li",
    render,
    props: mergeProps<"li">({ className: "paint-editor-row" }, props),
  });
}

interface ColorFieldProps {
  value: PaintColor;
  tokens?: readonly PaintToken[];
  onChange: (next: PaintColor) => void;
  labels?: Partial<PaintEditorLabels> | undefined;
  container?: Container;
}

/** Edits a literal CSS color or a stable token reference from the host document. */
export function PaintColorField({
  value,
  tokens = noTokens,
  onChange,
  labels,
  container,
}: ColorFieldProps) {
  const copy = { ...english, ...labels };
  const [draft, setDraft] = React.useState<string | null>(null);
  const errorId = React.useId();
  const [invalid, setInvalid] = React.useState(false);
  const colorPreview = React.useRef<HTMLSpanElement>(null);
  const binding = useTokenBinding(value, tokens, (next) => {
    setDraft(null);
    setInvalid(false);
    const swatch = colorPreview.current;
    const win = swatch?.ownerDocument.defaultView;
    onChange(
      next.token === undefined && swatch && win
        ? { value: win.getComputedStyle(swatch).backgroundColor }
        : next,
    );
  });
  const resolved = binding.resolved;
  if (value.token !== undefined && draft !== null) {
    setDraft(null);
    setInvalid(false);
  }
  function finish() {
    if (draft === null) return;
    const next = draft.trim();
    if (
      !CSS.supports("color", next) ||
      !CSS.supports("background-image", `linear-gradient(${next}, transparent)`)
    ) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setDraft(null);
    if (next !== resolved) onChange({ value: next });
  }
  return (
    <div className="paint-editor-field">
      <PropertyTokenField
        binding={binding}
        swatchRef={colorPreview}
        label={copy.token}
        color={(value) => value}
        missingLabel={copy.missingToken}
        detachLabel={copy.detachToken}
        container={container}
      >
        <label>
          {copy.color}
          <Input
            aria-invalid={invalid || undefined}
            aria-describedby={invalid ? errorId : undefined}
            value={draft ?? resolved}
            onChange={(e) => {
              setDraft(e.target.value);
              setInvalid(false);
            }}
            onBlur={finish}
            onKeyDown={(e) => {
              if (isComposingKey(e)) return;
              if (e.key === "Enter") {
                e.preventDefault();
                e.currentTarget.blur();
              }
              if (e.key === "Escape" && draft !== null) {
                e.preventDefault();
                e.stopPropagation();
                setInvalid(false);
                setDraft(null);
              }
            }}
          />
        </label>
      </PropertyTokenField>
      {invalid && (
        <span id={errorId} role="alert">
          {copy.invalid}
        </span>
      )}
    </div>
  );
}

const PaintEditLocked = React.createContext<(() => boolean) | null>(null);

function usePaintEdit<T>(
  value: T,
  onChange: Change<T>,
  onCancelPreview?: () => void,
) {
  const isLocked = React.useContext(PaintEditLocked);
  const original = React.useRef<{ value: T } | null>(null);
  const cancelPreview = React.useRef(onCancelPreview);
  React.useLayoutEffect(() => {
    cancelPreview.current = onCancelPreview;
  });
  React.useLayoutEffect(
    () => () => {
      if (original.current) {
        original.current = null;
        cancelPreview.current?.();
      }
    },
    [],
  );
  return (edit: PropertyEdit<T>) => {
    if (edit.phase === "cancel") {
      const saved = original.current;
      original.current = null;
      if (saved) {
        if (onCancelPreview) onCancelPreview();
        else onChange(saved.value, "commit");
      }
      return;
    }
    if (isLocked?.()) return;
    if (edit.phase === "preview") original.current ??= { value };
    else original.current = null;
    onChange(edit.value, edit.phase);
  };
}

function PaintNumber({
  value,
  label,
  onChange,
  onCancelPreview,
  ...props
}: Pick<PropertyNumberProps, "label" | "step" | "min" | "max" | "unit"> & {
  value: number;
  onChange: Change<number>;
  onCancelPreview?: (() => void) | undefined;
}) {
  const id = React.useId();
  const edit = usePaintEdit(value, onChange, onCancelPreview);
  return (
    <div className="paint-editor-field">
      <label htmlFor={id}>{label}</label>
      <PropertyNumber
        {...props}
        id={id}
        label={label}
        value={value}
        onEdit={edit}
      />
    </div>
  );
}

interface GradientProps {
  stops: readonly PaintStop[];
  tokens?: readonly PaintToken[];
  onChange: Change<readonly PaintStop[]>;
  onCancelPreview?: (() => void) | undefined;
  createId?: () => string;
  labels?: Partial<PaintEditorLabels> | undefined;
  container?: Container;
}
function newPaintId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

/** Gradient stops are ordered by offset and keyed by document identity, including coincident stops. */
export function PaintGradientStops({
  stops,
  onCancelPreview,
  tokens = noTokens,
  onChange,
  createId = newPaintId,
  labels,
  container,
}: GradientProps) {
  const copy = { ...english, ...labels };
  const [current, setCurrent] = React.useState(stops[0]?.id);
  const index = Math.max(
    0,
    stops.findIndex((s) => s.id === current),
  );
  const direction = useDirection();
  const editStops = usePaintEdit(stops, onChange, onCancelPreview);
  if (stops.length < 2)
    throw new Error("A linear paint requires at least two stops.");
  const stop = requireItem(stops, index);
  const positions = stops.map((s) => s.offset);
  function positionsChanged(next: readonly number[], phase: Phase) {
    editStops({
      phase,
      value: stops.map((stop, i) => {
        const offset = requireItem(next, i);
        return stop.offset === offset ? stop : { ...stop, offset };
      }),
    });
  }
  function replace(next: PaintStop, phase: Phase) {
    onChange(
      stops.map((s) => (s.id === next.id ? next : s)),
      phase,
    );
  }
  function add() {
    const right = index === stops.length - 1 ? index : index + 1;
    const left = requireItem(stops, right - 1);
    const newStop = {
      id: createId(),
      offset: (left.offset + requireItem(stops, right).offset) / 2,
      color: stop.color,
    };
    onChange(
      [...stops.slice(0, right), newStop, ...stops.slice(right)],
      "commit",
    );
    setCurrent(newStop.id);
  }
  const track = `linear-gradient(to ${direction === "rtl" ? "left" : "right"}, ${stops.map((s) => paintColor(s.color, tokens) + " " + s.offset + "%").join(", ")})`;
  return (
    <div className="paint-editor-stops">
      <Slider
        value={positions}
        minStepsBetweenValues={0}
        thumbCollisionBehavior="none"
        thumbAlignment="edge"
        onValueChange={(next) => positionsChanged(next, "preview")}
        onValueCommitted={(next, details) => {
          if (
            details.event.type === "pointercancel" ||
            details.event.type === "touchcancel"
          )
            editStops({ phase: "cancel" });
          else positionsChanged(next, "commit");
        }}
      >
        <SliderControl>
          <SliderTrack
            className="paint-editor-gradient"
            style={{ backgroundImage: track }}
          >
            {stops.map((s, i) => (
              <SliderThumb
                className="paint-editor-stop"
                index={i}
                key={s.id}
                aria-label={copy.stop(i)}
                onFocus={() => setCurrent(s.id)}
                onPointerDown={() => setCurrent(s.id)}
                style={{ backgroundColor: paintColor(s.color, tokens) }}
              />
            ))}
          </SliderTrack>
        </SliderControl>
      </Slider>
      <div className="paint-editor-controls">
        <PaintNumber
          key={stop.id}
          label={copy.position}
          value={stop.offset}
          step={0.1}
          min={stops[index - 1]?.offset ?? 0}
          max={stops[index + 1]?.offset ?? 100}
          onChange={(offset, phase) => replace({ ...stop, offset }, phase)}
          onCancelPreview={onCancelPreview}
        />
        <div className="flex gap-1">
          <IconButton
            type="button"
            color="gray"
            variant="ghost"
            aria-label={copy.addStop}
            title={copy.addStop}
            onClick={add}
          >
            <IconPlus />
          </IconButton>
          <IconButton
            type="button"
            color="gray"
            variant="ghost"
            aria-label={copy.removeStop}
            title={copy.removeStop}
            disabled={stops.length === 2}
            onClick={() => {
              onChange(
                stops.filter((s) => s.id !== stop.id),
                "commit",
              );
              setCurrent(requireItem(stops, index === 0 ? 1 : index - 1).id);
            }}
          >
            <IconMinus />
          </IconButton>
        </div>
      </div>
      <PaintColorField
        key={stop.id}
        value={stop.color}
        onChange={(color) => replace({ ...stop, color }, "commit")}
        tokens={tokens}
        container={container}
        labels={labels}
      />
    </div>
  );
}

export interface PaintEditorProps extends Omit<
  React.ComponentProps<typeof InspectorSection>,
  "children" | "onChange"
> {
  value: readonly Paint[];
  onValueChange: Change<readonly Paint[]>;
  /** Discard the host’s transient edit. Without a handler cancellation commits the original value. */
  onCancelPreview?: (() => void) | undefined;
  tokens?: readonly PaintToken[];
  labels?: Partial<PaintEditorLabels> | undefined;
  container?: Container;
  createId?: () => string;
  headerActions?: React.ReactNode;
  /** Show a direct remove action for a single fill; stacked fills retain their reorder menu. */
  singleFillRemove?: boolean;
  createPaint?: (kind: Paint["kind"]) => Paint;
  renderFields?: (
    paint: Paint,
    change: Change<Paint>,
    defaultFields: React.ReactNode,
  ) => React.ReactNode;
}

/** A controlled Fill section. Preview edits update the canvas, commit edits create host undo entries.
 * @import import { PaintEditor } from "@agent-native/toolkit/ui/base-ui/paint-editor";
 */
export function PaintEditor({
  value,
  onValueChange,
  onCancelPreview,
  tokens = noTokens,
  labels,
  container,
  createId = newPaintId,
  createPaint,
  headerActions,
  singleFillRemove,
  renderFields,
  ...sectionProps
}: PaintEditorProps) {
  const copy = { ...english, ...labels };
  const addButton = React.useRef<HTMLButtonElement>(null);
  const [overlayRevision, dismissOverlays] = React.useReducer(
    (n: number) => n + 1,
    0,
  );
  const locked = React.useCallback(
    () => addButton.current?.matches(":disabled") === true,
    [],
  );
  React.useLayoutEffect(() => {
    const trigger = addButton.current;
    const win = trigger?.ownerDocument.defaultView;
    if (!win || !trigger.closest("fieldset")) return;
    let wasLocked = locked();
    const observer = new win.MutationObserver(() => {
      const isLocked = locked();
      if (isLocked && !wasLocked) dismissOverlays();
      wasLocked = isLocked;
    });
    observeFieldsetDisabled(trigger, observer);
    return () => observer.disconnect();
  }, [locked]);
  const buttons = React.useRef(new Map<string, HTMLButtonElement>());
  const [focusId, setFocusId] = React.useState<string | null>(null);
  React.useLayoutEffect(() => {
    if (focusId === null) return;
    const target = buttons.current.get(focusId) ?? addButton.current;
    target?.focus();
    setFocusId(null);
  }, [value, focusId]);
  function add(kind: Paint["kind"]) {
    if (locked()) return;
    const base = { id: createId(), visible: true, opacity: 100 };
    const paint: Paint = createPaint
      ? createPaint(kind)
      : kind === "solid"
        ? { ...base, kind, color: { value: "currentColor" } }
        : {
            ...base,
            kind,
            angle: 90,
            stops: [
              { id: createId(), offset: 0, color: { value: "transparent" } },
              { id: createId(), offset: 100, color: { value: "currentColor" } },
            ],
          };
    onValueChange([paint, ...value], "commit");
    setFocusId(paint.id);
  }
  function move(index: number, to: number) {
    if (locked()) return;
    const next = value.slice();
    const paint = requireItem(value, index);
    next[index] = requireItem(value, to);
    next[to] = paint;
    onValueChange(next, "commit");
    setFocusId(paint.id);
  }
  const addControl = (
    <Menu key={`menu-${overlayRevision}`}>
      <MenuTrigger
        render={
          <IconButton
            ref={addButton}
            type="button"
            variant="ghost"
            color="gray"
            aria-label={copy.add}
            title={copy.add}
          />
        }
      >
        <IconPlus />
      </MenuTrigger>
      <MenuPopup container={container} align="end">
        <MenuItem onClick={() => add("solid")}>{copy.solid}</MenuItem>
        <MenuItem onClick={() => add("linear")}>{copy.linear}</MenuItem>
      </MenuPopup>
    </Menu>
  );
  return (
    <InspectorSection
      {...mergeProps<"section">({ className: "paint-editor" }, sectionProps)}
    >
      <InspectorSectionHeader>
        <h3 className="type-label">{copy.fill}</h3>
        <div className="paint-editor-actions">
          {headerActions}
          {addControl}
        </div>
      </InspectorSectionHeader>
      <InspectorContent>
        <PaintList aria-label={copy.fill}>
          {value.map((paint, i) => {
            const name = copy.layer(
              paint.kind === "linear" ? copy.linear : copy.solid,
              i,
            );
            const display =
              paint.kind === "linear"
                ? copy.linear
                : (tokens.find((t) => t.id === paint.color.token)?.label ??
                  paint.color.value);
            const change: Change<Paint> = (next, phase) => {
              if (locked()) return;
              onValueChange(
                value.map((p) => (p.id === paint.id ? next : p)),
                phase,
              );
            };
            const remove = () => {
              if (locked()) return;
              onValueChange(
                value.filter((p) => p.id !== paint.id),
                "commit",
              );
              setFocusId(
                indexedItem(value, i + 1)?.id ??
                  indexedItem(value, i - 1)?.id ??
                  paint.id,
              );
            };
            const defaultFields = (
              <>
                <div className="paint-editor-controls">
                  <PaintNumber
                    label={copy.opacity}
                    min={0}
                    max={100}
                    value={paint.opacity}
                    onChange={(opacity, phase) =>
                      change({ ...paint, opacity }, phase)
                    }
                    onCancelPreview={onCancelPreview}
                  />
                  {paint.kind === "linear" && (
                    <PaintNumber
                      label={copy.angle}
                      unit="degree"
                      value={paint.angle}
                      onChange={(angle, phase) =>
                        change({ ...paint, angle }, phase)
                      }
                      onCancelPreview={onCancelPreview}
                    />
                  )}
                </div>
                {paint.kind === "solid" ? (
                  <PaintColorField
                    value={paint.color}
                    tokens={tokens}
                    labels={labels}
                    container={container}
                    onChange={(color) => change({ ...paint, color }, "commit")}
                  />
                ) : (
                  <PaintGradientStops
                    stops={paint.stops}
                    onCancelPreview={onCancelPreview}
                    tokens={tokens}
                    labels={labels}
                    container={container}
                    createId={createId}
                    onChange={(stops, phase) =>
                      change({ ...paint, stops }, phase)
                    }
                  />
                )}
              </>
            );
            return (
              <PaintRow
                key={paint.id}
                aria-label={name}
                data-paint-id={paint.id}
              >
                <Popover key={overlayRevision}>
                  <PopoverTrigger
                    render={
                      <Button
                        type="button"
                        variant="surface"
                        color="gray"
                        ref={(node) => {
                          if (node) buttons.current.set(paint.id, node);
                          else buttons.current.delete(paint.id);
                        }}
                        className="paint-editor-trigger"
                        aria-label={copy.edit + " " + name}
                      />
                    }
                  >
                    <span
                      aria-hidden="true"
                      className="paint-editor-chip"
                      style={{
                        backgroundImage: paintBackground(
                          [{ ...paint, visible: true }],
                          tokens,
                        ),
                      }}
                    />
                    {paint.kind === "solid" &&
                    paint.color.token !== undefined ? (
                      <Badge
                        className="property-token-badge"
                        variant="surface"
                        color="gray"
                        title={display}
                      >
                        <span>{display}</span>
                      </Badge>
                    ) : (
                      <span className="truncate">{display}</span>
                    )}
                    <span className="ms-auto text-fg-muted">
                      {paint.opacity}%
                    </span>
                  </PopoverTrigger>
                  <PopoverPopup container={container} align="end">
                    <PopoverTitle>{copy.edit + " " + name}</PopoverTitle>
                    <div className="paint-editor-stops">
                      <PaintEditLocked.Provider value={locked}>
                        {renderFields
                          ? renderFields(paint, change, defaultFields)
                          : defaultFields}
                      </PaintEditLocked.Provider>
                    </div>
                  </PopoverPopup>
                </Popover>
                <IconButton
                  type="button"
                  color="gray"
                  variant="ghost"
                  aria-label={
                    (paint.visible ? copy.hide : copy.show) + " " + name
                  }
                  onClick={() =>
                    change({ ...paint, visible: !paint.visible }, "commit")
                  }
                >
                  {paint.visible ? <IconEye /> : <IconEyeOff />}
                </IconButton>
                {singleFillRemove && value.length === 1 ? (
                  <IconButton
                    type="button"
                    variant="ghost"
                    color="gray"
                    aria-label={copy.remove + " " + name}
                    onClick={remove}
                  >
                    <IconMinus />
                  </IconButton>
                ) : (
                  <Menu key={`menu-${overlayRevision}`}>
                    <MenuTrigger
                      render={
                        <IconButton
                          type="button"
                          color="gray"
                          variant="ghost"
                          aria-label={copy.actions + " " + name}
                        />
                      }
                    >
                      <IconDots />
                    </MenuTrigger>
                    <MenuPopup container={container} align="end">
                      <MenuItem
                        disabled={i === 0}
                        onClick={() => move(i, i - 1)}
                      >
                        {copy.moveUp}
                      </MenuItem>
                      <MenuItem
                        disabled={i === value.length - 1}
                        onClick={() => move(i, i + 1)}
                      >
                        {copy.moveDown}
                      </MenuItem>
                      <MenuItem onClick={remove}>{copy.remove}</MenuItem>
                    </MenuPopup>
                  </Menu>
                )}
              </PaintRow>
            );
          })}
        </PaintList>
      </InspectorContent>
    </InspectorSection>
  );
}
