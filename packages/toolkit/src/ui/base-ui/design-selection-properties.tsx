import { Toolbar as BaseToolbar } from "@base-ui/react/toolbar";
import {
  IconAngle,
  IconChevronDown,
  IconArrowBackUp,
  IconArrowForwardUp,
  IconBorderCorners,
  IconBoxModel2,
  IconCode,
  IconComponents,
  IconDots,
  IconDroplet,
  IconEye,
  IconEyeOff,
  IconFlipHorizontal,
  IconFlipVertical,
  IconFrame,
  IconGridDots,
  IconLayoutAlignBottom,
  IconLayoutAlignCenter,
  IconLayoutAlignLeft,
  IconLayoutAlignMiddle,
  IconLayoutAlignRight,
  IconLayoutAlignTop,
  IconLayoutDistributeHorizontal,
  IconLayoutGrid,
  IconMinus,
  IconLock,
  IconPlus,
  IconRadiusTopLeft,
  IconRotateClockwise,
  IconX,
} from "@tabler/icons-react";
import * as React from "react";

import { Button, IconButton } from "./button.js";
import {
  DesignPropertyInspector,
  DesignPropertySection as Section,
  DesignSelectionHeader,
} from "./design-property-inspector.js";
import { requireItem } from "./indexed-item.js";
import { InspectorGrid } from "./inspector.js";
import {
  AutoLayoutControls,
  LayoutDimensions,
  PropertyNumber,
  createLayoutResize,
  resizeLayout,
  canLockAspectRatio,
  canResizeWithAspectRatio,
  type AutoLayoutValue,
  type PropertyEdit,
  type LayoutResize,
  type LayoutSizeLimits,
} from "./layout-properties.js";
import type { LayoutDimensionsValue } from "./layout-properties.js";
import {
  Menu,
  MenuTrigger,
  MenuPopup,
  MenuItem,
  MenuSeparator,
} from "./menu.js";
import {
  createPaintStackEdit,
  PaintEditor,
  type Paint,
  type PaintToken,
} from "./paint-editor.js";
import {
  Popover,
  PopoverTrigger,
  PopoverPopup,
  PopoverTitle,
} from "./popover.js";
import {
  PropertyTokenField,
  useTokenBinding,
  resolvePropertyToken,
  type PropertyToken,
} from "./property-token.js";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectPopup,
  SelectItem,
} from "./select.js";
import { Text } from "./text.js";
import { Toggle } from "./toggle.js";
export interface DesignLayerGeometry extends LayoutDimensionsValue {
  x: number;
  y: number;
  rotation: number;
  opacity: number;
  radius: number;
  radiusToken?: string;
  flipX: boolean;
  flipY: boolean;
  stroke: number;
  shadow: number;
  state: "Default" | "Hover" | "Focus";
  responsive: { maxWidth: number; padding: number } | null;
  blend: "normal" | "multiply" | "screen";
  auto: AutoLayoutValue | null;
  paints: readonly Paint[] | null;
}
export interface DesignLayerIdentity {
  id: string;
  name: string;
  /** Sibling coordinates are comparable only within this shared parent. */
  parentId?: string | null;
  kind: string;
  container?: boolean;
}
type LayerGeometry = DesignLayerGeometry;

type NumericProperty =
  | "x"
  | "y"
  | "rotation"
  | "opacity"
  | "radius"
  | "stroke"
  | "shadow";
function commonValue<T>(
  layers: readonly LayerGeometry[],
  read: (layer: LayerGeometry) => T,
) {
  const first = read(requireItem(layers, 0));
  for (let i = 1; i < layers.length; i++) {
    if (!Object.is(first, read(requireItem(layers, i)))) return null;
  }
  return first;
}
const numberValues = {
  x: (layer) => layer.x,
  y: (layer) => layer.y,
  rotation: (layer) => layer.rotation,
  opacity: (layer) => layer.opacity,
  radius: (layer) => layer.radius,
  stroke: (layer) => layer.stroke,
  shadow: (layer) => layer.shadow,
} satisfies Record<NumericProperty, (layer: LayerGeometry) => number>;
function setNumber(key: NumericProperty) {
  return <G extends LayerGeometry>(layer: G, value: number): G => ({
    ...layer,
    [key]: value,
    ...(key === "radius" && layer.radiusToken !== undefined
      ? { radiusToken: undefined }
      : {}),
  });
}
const numberPrefixes = {
  x: "X",
  y: "Y",
  rotation: <IconAngle />,
  opacity: <IconGridDots />,
  radius: <IconRadiusTopLeft />,
  stroke: "px",
  shadow: "px",
} satisfies Record<NumericProperty, React.ReactNode>;

const SelectionNumber = React.memo(function SelectionNumber({
  property,
  edit,
  ...props
}: Omit<React.ComponentProps<typeof PropertyNumber>, "onEdit" | "prefix"> & {
  property: NumericProperty;
  edit: (
    event: PropertyEdit<number>,
    update: ReturnType<typeof setNumber>,
  ) => void;
}) {
  return (
    <PropertyNumber
      {...props}
      prefix={numberPrefixes[property]}
      onEdit={(event) => edit(event, setNumber(property))}
    />
  );
});
function RadiusField<G extends LayerGeometry>({
  current,
  tokens,
  label,
  apply,
  children,
}: {
  current: readonly G[];
  tokens: readonly PropertyToken<number>[];
  label: string;
  apply: (update: (layer: G) => G) => void;
  children: React.ReactNode;
}) {
  const id = commonValue(current, (layer) => layer.radiusToken);
  const detach = () =>
    apply((layer) => ({
      ...layer,
      radiusToken: undefined,
      radius: resolvePropertyToken(
        {
          ...(layer.radiusToken === undefined
            ? {}
            : { token: layer.radiusToken }),
          value: layer.radius,
        },
        tokens,
      ),
    }));
  const binding = useTokenBinding(
    {
      ...(id == null ? {} : { token: id }),
      value: requireItem(current, 0).radius,
    },
    tokens,
    (next) => {
      if (next.token === undefined) detach();
      else
        apply((layer) => ({
          ...layer,
          radiusToken: next.token,
          radius: next.value,
        }));
    },
  );
  return (
    <PropertyTokenField
      binding={binding}
      prefix={<IconRadiusTopLeft />}
      {...(id === null ? { mixed: { label: "Mixed", detach } } : {})}
      label={label + " token"}
      format={(n) => n + "px"}
    >
      {children}
    </PropertyTokenField>
  );
}

function applyResize<G extends LayerGeometry>(
  layer: G,
  resize: ReturnType<typeof createLayoutResize>,
) {
  return resize(layer);
}
function patchAutoLayout(defaults: AutoLayoutValue) {
  return <G extends LayerGeometry>(
    layer: G,
    patch: Partial<AutoLayoutValue>,
  ): G => ({
    ...layer,
    auto: { ...(layer.auto ?? defaults), ...patch },
  });
}
function applyPaintUpdate<G extends LayerGeometry>(
  layer: G,
  update: ReturnType<typeof createPaintStackEdit>,
): G {
  return { ...layer, paints: update(layer.paints ?? undefined) };
}

const defaultRule = { maxWidth: 640, padding: 24 };
const breakpoints = new Map([
  [640, "sm"],
  [768, "md"],
  [1024, "lg"],
]);
function breakpointLabel(width: number) {
  const name = breakpoints.get(width);
  return name ? `Below ${name} · ${width}` : `Below ${width}px`;
}

const limits = { min: 1, max: 20000 };
export interface DesignSelectionPropertiesProps<
  Geometry extends DesignLayerGeometry = DesignLayerGeometry,
> {
  /** Override or hide one of the standard sections while preserving its position. */
  sections?: React.ComponentProps<typeof DesignPropertyInspector>["sections"];
  sizeLimits?: LayoutSizeLimits;
  exportSection?: React.ReactNode;
  renderCode?: (geometry: Geometry) => React.ReactNode;
  collaboration?: React.ReactNode;
  instanceControl?: React.ReactNode;
  /** Trailing action beside the position fields, such as a ConstraintPicker. */
  renderPositionAction?: (selection: {
    layers: readonly DesignLayerIdentity[];
    current: readonly Geometry[];
    readOnly: boolean;
  }) => React.ReactNode;
  className?: string;
  ariaLabel?: string;
  /** Extra application sections follow the standard property groups. */
  children?: React.ReactNode;
  layers: readonly DesignLayerIdentity[];
  current: readonly Geometry[];
  title: string;
  visible: boolean | "mixed";
  /** Include descendants of locked ancestors when the host supports nested layers. */
  lockedLayerIds?: ReadonlySet<string>;
  setVisible: (v: boolean) => void;
  apply: (update: (original: Geometry) => Geometry) => void;
  edit: <T>(
    e: PropertyEdit<T>,
    update: (original: Geometry, value: T) => Geometry,
  ) => void;
  paints: readonly Paint[] | null;
  firstFill: readonly Paint[];
  tokens: readonly PaintToken[];
  radiusTokens?: readonly PropertyToken<number>[];
  automatic: AutoLayoutValue;
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
}
function Action({
  label,
  children,
  ...props
}: { label: string; children: React.ReactNode } & React.ComponentProps<
  typeof IconButton
>) {
  return (
    <IconButton
      variant="ghost"
      color="gray"
      aria-label={label}
      title={label}
      {...props}
    >
      {children}
    </IconButton>
  );
}
function FlyoutContents({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode | (() => React.ReactNode);
}) {
  return (
    <>
      <PopoverTitle>{label}</PopoverTitle>
      {typeof children === "function" ? children() : children}
    </>
  );
}
function Flyout({
  label,
  trigger,
  children,
}: {
  label: string;
  trigger: React.ReactElement;
  children: React.ComponentProps<typeof FlyoutContents>["children"];
}) {
  return (
    <Popover>
      <PopoverTrigger render={trigger} />
      <PopoverPopup
        className="design-property-inspector-property-popup"
        align="end"
      >
        <FlyoutContents label={label}>{children}</FlyoutContents>
      </PopoverPopup>
    </Popover>
  );
}
function Choice<T extends string | number>({
  label,
  value,
  values,
  format = String,
  onChange,
}: {
  label: string;
  value: T | null;
  values: readonly T[];
  format?: (value: T) => string;
  onChange: (next: T) => void;
}) {
  return (
    <Select
      aria-label={label}
      value={value}
      onValueChange={(v) => {
        if (v !== null) onChange(v);
      }}
    >
      <SelectTrigger>
        <SelectValue placeholder="Mixed">
          {value === null ? undefined : format(value)}
        </SelectValue>
      </SelectTrigger>
      <SelectPopup>
        {values.map((v) => (
          <SelectItem key={v} value={v}>
            {format(v)}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}
function HistoryMenu({
  undo,
  redo,
  canUndo,
  canRedo,
}: {
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}) {
  return (
    <Menu>
      <MenuTrigger
        render={
          <Action label="Selection actions">
            <IconDots />
          </Action>
        }
      />
      <MenuPopup>
        <MenuItem disabled={!canUndo} onClick={undo}>
          Undo
        </MenuItem>
        <MenuItem disabled={!canRedo} onClick={redo}>
          Redo
        </MenuItem>
      </MenuPopup>
    </Menu>
  );
}
function CodePreview<Geometry extends DesignLayerGeometry>({
  geometry,
  renderCode,
}: {
  geometry: Geometry;
  renderCode?: DesignSelectionPropertiesProps<Geometry>["renderCode"];
}) {
  return renderCode ? (
    <>{renderCode(geometry)}</>
  ) : (
    <pre>{JSON.stringify(geometry, null, 2)}</pre>
  );
}
/** A controlled design inspector with standard geometry, appearance and paint sections.
 * @import import { DesignSelectionProperties } from "@agent-native/toolkit/ui/base-ui/design-property-inspector";
 */
export function DesignSelectionProperties<
  Geometry extends DesignLayerGeometry,
>({
  collaboration,
  exportSection,
  renderCode,
  sections,
  sizeLimits = limits,
  instanceControl,
  renderPositionAction,
  className,
  ariaLabel = "Layer properties",
  children,
  layers: selectedLayers,
  current: selectedGeometry,
  lockedLayerIds,
  title,
  visible,
  setVisible,
  apply,
  edit,
  paints,
  firstFill,
  tokens,
  radiusTokens,
  automatic,
  canUndo,
  canRedo,
  undo,
  redo,
}: DesignSelectionPropertiesProps<Geometry>) {
  if (selectedLayers.length !== selectedGeometry.length)
    throw new Error("Expected one property record per selected layer.");
  const selectionIds = React.useMemo(
    () => JSON.stringify(selectedLayers.map((layer) => layer.id)),
    [selectedLayers],
  );
  const paintGesture = React.useRef<{
    selectionKey: string;
    source: readonly Paint[];
  } | null>(null);
  const eligible = React.useMemo(() => {
    if (
      !lockedLayerIds?.size ||
      !selectedLayers.some((layer) => lockedLayerIds.has(layer.id))
    )
      return null;
    const indices: number[] = [];
    for (const [index, layer] of selectedLayers.entries()) {
      if (!lockedLayerIds.has(layer.id)) indices.push(index);
    }
    return indices;
  }, [selectedLayers, lockedLayerIds]);
  const selectionKey = React.useMemo(
    () =>
      eligible === null
        ? selectionIds
        : selectionIds + ":" + eligible.join(","),
    [selectionIds, eligible],
  );
  const lockedCount = eligible ? selectedLayers.length - eligible.length : 0;
  const readOnly = lockedCount > 0 && lockedCount === selectedLayers.length;
  const layers = React.useMemo(
    () =>
      eligible?.length
        ? eligible.map((i) => requireItem(selectedLayers, i))
        : selectedLayers,
    [eligible, selectedLayers],
  );
  const current = React.useMemo(
    () =>
      eligible?.length
        ? eligible.map((i) => requireItem(selectedGeometry, i))
        : selectedGeometry,
    [eligible, selectedGeometry],
  );
  const hasDefaultPosition = !sections || !Object.hasOwn(sections, "position");
  const canAlign = React.useMemo(() => {
    if (!hasDefaultPosition || readOnly || layers.length < 2) return false;
    const parent = layers[0]?.parentId;
    return (
      parent !== undefined && layers.every((layer) => layer.parentId === parent)
    );
  }, [layers, hasDefaultPosition, readOnly]);
  const editDimensions = React.useCallback(
    (event: PropertyEdit<LayoutResize>) =>
      edit(
        event.phase === "cancel"
          ? event
          : {
              phase: event.phase,
              value: createLayoutResize(event.value, sizeLimits),
            },
        applyResize,
      ),
    [edit, sizeLimits],
  );
  const dimensionMenus = React.useMemo(() => {
    const dimensionMenu = (axis: "width" | "height") => (
      <Menu>
        <MenuTrigger
          render={
            <Action
              size="sm"
              label={axis === "width" ? "Width presets" : "Height presets"}
            >
              <IconChevronDown />
            </Action>
          }
        />
        <MenuPopup>
          {[0.5, 1.5, 2].map((scale) => (
            <MenuItem
              key={scale}
              onClick={() =>
                apply((o) =>
                  resizeLayout(o, { axis, value: o[axis] * scale }, sizeLimits),
                )
              }
            >
              {scale * 100}%
            </MenuItem>
          ))}
        </MenuPopup>
      </Menu>
    );
    return { width: dimensionMenu("width"), height: dimensionMenu("height") };
  }, [apply, sizeLimits]);
  if (!layers.length)
    return (
      <DesignPropertyInspector
        className={className}
        aria-label={ariaLabel}
        collaboration={collaboration}
      >
        {children}
      </DesignPropertyInspector>
    );
  const selection = requireItem(layers, 0),
    g = requireItem(current, 0),
    single = selectedLayers.length === 1;
  const frame = single && selection.container;
  const action = (
    label: string,
    icon: React.ReactNode,
    fn: () => void,
    disabled = false,
  ) => (
    <Action label={label} onClick={fn} disabled={disabled}>
      {icon}
    </Action>
  );
  const tool = (
    label: string,
    icon: React.ReactNode,
    checked: boolean | "mixed",
    fn: (v: boolean) => void,
  ) => (
    <Toggle
      color="gray"
      aria-label={label}
      title={label}
      pressed={checked === true}
      aria-pressed={checked}
      onPressedChange={fn}
    >
      {icon}
    </Toggle>
  );
  const inspection = single
    ? selection.kind === "text"
      ? "span"
      : "div"
    : title;
  const history = (
    <>
      {(canUndo || !single) &&
        action("Undo", <IconArrowBackUp />, undo, !canUndo)}
      {(canRedo || !single) &&
        action("Redo", <IconArrowForwardUp />, redo, !canRedo)}
    </>
  );
  const selectedHeader = (
    <DesignSelectionHeader
      actions={
        <div className="design-property-inspector-property-actions">
          {history}
          {single && (
            <Flyout
              label="Component"
              trigger={
                <Action label="Component details">
                  <IconComponents />
                </Action>
              }
            >
              <p>{title}</p>
              <p>{selection.kind}</p>
            </Flyout>
          )}
          <Flyout
            label="View code"
            trigger={
              <Action label="View code">
                <IconCode />
              </Action>
            }
          >
            <CodePreview geometry={g} renderCode={renderCode} />
          </Flyout>
        </div>
      }
    >
      <Text render={<strong />} textStyle="label-large">
        <IconFrame />
        {inspection}
        {lockedCount > 0 && (
          <span
            role="img"
            title={lockedCount + " locked"}
            aria-label={lockedCount + " locked"}
          >
            <IconLock aria-hidden />
          </span>
        )}
      </Text>
    </DesignSelectionHeader>
  );
  const instance = single && (
    <div className="design-property-inspector-instance">
      <div className="design-property-inspector-instance-heading">
        <Text textStyle="label">
          <IconComponents />
          {title}
        </Text>
        <HistoryMenu {...{ undo, redo, canUndo, canRedo }} />
      </div>
      {instanceControl}
      <Choice
        label="Preview state"
        value={g.state}
        values={["Default", "Hover", "Focus"]}
        onChange={(v) =>
          apply((o) => ({ ...o, state: v as LayerGeometry["state"] }))
        }
      />
    </div>
  );
  const num = (
    label: string,
    key: NumericProperty,
    unit?: string,
    min?: number,
    max?: number,
  ) => {
    const field = (
      <SelectionNumber
        label={label}
        property={key}
        unit={unit}
        min={min}
        max={max}
        value={commonValue(current, numberValues[key])}
        placeholder="Mixed"
        edit={edit}
      />
    );
    return key === "radius" && radiusTokens ? (
      <RadiusField
        current={current}
        tokens={radiusTokens}
        label={label}
        apply={apply}
      >
        {field}
      </RadiusField>
    ) : (
      field
    );
  };
  function alignSelection(axis: number, index: number) {
    const key = axis ? "y" : "x",
      size = axis ? "height" : "width";
    let min = Infinity;
    let max = -Infinity;
    for (const layer of current) {
      const point = layer[key] + (index * layer[size]) / 2;
      min = Math.min(min, point);
      max = Math.max(max, point);
    }
    if (min === max) return;
    const anchor = index === 0 ? min : index === 2 ? max : (min + max) / 2;
    apply((layer) => {
      const position = anchor - (index * layer[size]) / 2;
      return position === layer[key] ? layer : { ...layer, [key]: position };
    });
  }
  function renderPosition() {
    const transform = (
      <div className="design-property-inspector-transform">
        {action("Rotate 90 degrees", <IconRotateClockwise />, () =>
          apply((o) => ({ ...o, rotation: (o.rotation + 90) % 360 })),
        )}
        {tool(
          "Flip horizontal",
          <IconFlipHorizontal />,
          commonValue(current, (layer) => layer.flipX) ?? "mixed",
          (v) => apply((o) => ({ ...o, flipX: v })),
        )}
        {tool(
          "Flip vertical",
          <IconFlipVertical />,
          commonValue(current, (layer) => layer.flipY) ?? "mixed",
          (v) => apply((o) => ({ ...o, flipY: v })),
        )}
      </div>
    );
    const groups = [
      [IconLayoutAlignLeft, IconLayoutAlignCenter, IconLayoutAlignRight],
      [IconLayoutAlignTop, IconLayoutAlignMiddle, IconLayoutAlignBottom],
    ];
    const positionAction = renderPositionAction?.({
      layers,
      current,
      readOnly,
    });
    return (
      <Section
        title="Position"
        actions={
          <div className="design-property-inspector-property-actions">
            {frame &&
              tool(
                "Auto layout",
                <IconLayoutDistributeHorizontal />,
                !!g.auto,
                (v) => apply((o) => ({ ...o, auto: v ? automatic : null })),
              )}
          </div>
        }
      >
        <InspectorGrid className="design-property-inspector-position-pair">
          {groups.map((icons, axis) => (
            <BaseToolbar.Root
              className="segmented-control"
              key={axis}
              aria-label={axis ? "Vertical alignment" : "Horizontal alignment"}
              disabled={!canAlign}
            >
              {icons.map((Glyph, i) => (
                <BaseToolbar.Button
                  className="segmented-control-item"
                  focusableWhenDisabled={false}
                  key={i}
                  onClick={() => alignSelection(axis, i)}
                  aria-label={
                    (axis
                      ? ["Align top", "Align middle", "Align bottom"]
                      : ["Align left", "Align center", "Align right"])[i]
                  }
                >
                  <Glyph />
                </BaseToolbar.Button>
              ))}
            </BaseToolbar.Root>
          ))}
        </InspectorGrid>
        <InspectorGrid>
          {num("X", "x")}
          {num("Y", "y")}
          {positionAction === undefined ? (
            <Flyout
              label="Position"
              trigger={
                <Action label="Position details">
                  <IconBoxModel2 />
                </Action>
              }
            >
              {() => (
                <>
                  <p>Parent-relative coordinates</p>
                  <code>
                    X {commonValue(current, (layer) => layer.x) ?? "Mixed"} · Y{" "}
                    {commonValue(current, (layer) => layer.y) ?? "Mixed"}
                  </code>
                </>
              )}
            </Flyout>
          ) : (
            positionAction
          )}
        </InspectorGrid>
        <InspectorGrid className="design-property-inspector-position-pair">
          {num("Rotation", "rotation", "degree")}
          {transform}
        </InspectorGrid>
      </Section>
    );
  }
  const renderLayout = () => {
    let width: number | null = g.width;
    let height: number | null = g.height;
    let hasLocked = false;
    let hasUnlocked = false;
    let cannotAddLock = false;
    let incompatibleLock = false;
    for (const layer of current) {
      if (!Object.is(layer.width, width)) width = null;
      if (!Object.is(layer.height, height)) height = null;
      if (layer.aspectRatio !== null) {
        hasLocked = true;
        if (
          !incompatibleLock &&
          !canResizeWithAspectRatio(layer.aspectRatio, sizeLimits)
        )
          incompatibleLock = true;
      } else {
        hasUnlocked = true;
        if (
          !cannotAddLock &&
          !canLockAspectRatio(layer.width, layer.height, sizeLimits)
        )
          cannotAddLock = true;
      }
      if (width === null && height === null && hasUnlocked && incompatibleLock)
        break;
    }
    return (
      <Section title="Layout" className="design-property-inspector-layout">
        <LayoutDimensions
          {...(incompatibleLock ? {} : { suffixes: dimensionMenus })}
          dimensionsReadOnly={incompatibleLock}
          width={width}
          height={height}
          locked={hasLocked && hasUnlocked ? "mixed" : hasLocked}
          lockDisabled={!hasLocked && cannotAddLock}
          limits={sizeLimits}
          onLockChange={(on) => {
            const lock = on && !incompatibleLock && !cannotAddLock;
            apply((o) => {
              const aspectRatio = lock
                ? (o.aspectRatio ?? o.width / o.height)
                : null;
              return o.aspectRatio === aspectRatio ? o : { ...o, aspectRatio };
            });
          }}
          onEdit={editDimensions}
        />
        {frame && g.auto && (
          <AutoLayoutControls
            value={g.auto}
            onEdit={(e) => edit(e, patchAutoLayout(automatic))}
          />
        )}
      </Section>
    );
  };
  const renderAppearance = () => (
    <Section
      title="Appearance"
      actions={
        <div className="design-property-inspector-property-actions">
          {tool(
            "Layer visible",
            visible ? <IconEye /> : <IconEyeOff />,
            visible,
            setVisible,
          )}
          <Flyout
            label="Blend mode"
            trigger={
              <Action label="Blend mode">
                <IconDroplet />
              </Action>
            }
          >
            {() => (
              <Choice
                label="Blend mode"
                value={commonValue(current, (layer) => layer.blend)}
                values={["normal", "multiply", "screen"]}
                onChange={(v) =>
                  apply((o) => ({ ...o, blend: v as LayerGeometry["blend"] }))
                }
              />
            )}
          </Flyout>
        </div>
      }
    >
      <InspectorGrid>
        {num("Opacity", "opacity", "percent", 0, 100)}
        {num("Corner radius", "radius", undefined, 0)}
        <Flyout
          label="Corners"
          trigger={
            <Action label="Corner radius settings">
              <IconBorderCorners />
            </Action>
          }
        >
          {() => num("All corners", "radius", undefined, 0)}
        </Flyout>
      </InspectorGrid>
    </Section>
  );
  const firstColor =
    paints?.[0]?.kind === "solid" ? paints[0].color : undefined;
  const renderFill = () =>
    paints !== null ? (
      <PaintEditor
        singleFillRemove
        headerActions={
          (tokens.length > 0 || firstColor?.token !== undefined) && (
            <Menu>
              <MenuTrigger
                render={
                  <Action label="Fill styles">
                    <IconLayoutGrid />
                  </Action>
                }
              />
              <MenuPopup>
                {firstColor?.token !== undefined && (
                  <>
                    <MenuItem
                      onClick={(event) => {
                        const swatch =
                          event.currentTarget.querySelector<HTMLElement>(
                            ".property-token-swatch",
                          );
                        const color =
                          swatch &&
                          swatch.ownerDocument.defaultView?.getComputedStyle(
                            swatch,
                          ).backgroundColor;
                        const first = paints.at(0);
                        if (first?.kind !== "solid") return;
                        const next = [
                          {
                            ...first,
                            color: {
                              value:
                                color ||
                                resolvePropertyToken(firstColor, tokens),
                            },
                          },
                          ...paints.slice(1),
                        ];
                        const update = createPaintStackEdit(paints, next);
                        apply((layer) => applyPaintUpdate(layer, update));
                      }}
                    >
                      Detach
                      <span
                        aria-hidden
                        className="property-token-swatch"
                        style={{
                          backgroundColor: resolvePropertyToken(
                            firstColor,
                            tokens,
                          ),
                        }}
                      />
                    </MenuItem>
                    {tokens.length > 0 && <MenuSeparator />}
                  </>
                )}
                {tokens.map((token) => (
                  <MenuItem
                    key={token.id}
                    onClick={() => {
                      const next: readonly Paint[] = [
                        {
                          id: paints[0]?.id ?? crypto.randomUUID(),
                          kind: "solid",
                          color: { token: token.id, value: token.value },
                          visible: paints[0]?.visible ?? true,
                          opacity: paints[0]?.opacity ?? 100,
                        },
                        ...paints.slice(1),
                      ];
                      const update = createPaintStackEdit(paints, next);
                      apply((layer) => applyPaintUpdate(layer, update));
                    }}
                  >
                    {token.label}
                  </MenuItem>
                ))}
              </MenuPopup>
            </Menu>
          )
        }
        value={paints}
        onCancelPreview={() => {
          paintGesture.current = null;
          edit({ phase: "cancel" }, (layer) => layer);
        }}
        tokens={tokens}
        onValueChange={(next, phase) => {
          const gesture = paintGesture.current;
          const source =
            gesture?.selectionKey === selectionKey ? gesture.source : paints;
          paintGesture.current =
            phase === "preview" ? { selectionKey, source } : null;
          edit(
            { phase, value: createPaintStackEdit(source, next) },
            applyPaintUpdate,
          );
        }}
      />
    ) : (
      <Section title="Fill">
        <div className="design-property-inspector-mixed-paints">
          Mixed fills
          <Button
            variant="surface"
            color="gray"
            onClick={() => apply((o) => ({ ...o, paints: firstFill }))}
          >
            Use first fill
          </Button>
        </div>
      </Section>
    );
  const propertyStyle = (
    name: "Stroke" | "Effects",
    key: "stroke" | "shadow",
    presets: readonly number[],
  ) => {
    const enabled = current.some((o) => o[key] > 0);
    return (
      <Section
        title={name}
        actions={
          <div className="design-property-inspector-property-actions">
            <Menu>
              <MenuTrigger
                render={
                  <Action label={name + " styles"}>
                    <IconLayoutGrid />
                  </Action>
                }
              />
              <MenuPopup>
                {presets.map((v) => (
                  <MenuItem
                    key={v}
                    onClick={() => apply((o) => ({ ...o, [key]: v }))}
                  >
                    {v}px
                  </MenuItem>
                ))}
              </MenuPopup>
            </Menu>
            {action(
              (enabled ? "Remove " : "Add ") + name.toLowerCase(),
              enabled ? <IconMinus /> : <IconPlus />,
              () => apply((o) => ({ ...o, [key]: enabled ? 0 : presets[0] })),
            )}
          </div>
        }
      >
        {enabled ? (
          <InspectorGrid>
            {num(
              key === "stroke" ? "Stroke width" : "Shadow blur",
              key,
              undefined,
              0,
              100,
            )}
          </InspectorGrid>
        ) : null}
      </Section>
    );
  };
  function renderResponsive() {
    const hasRule = current.some((layer) => layer.responsive !== null);
    const allHaveRules =
      hasRule && current.every((layer) => layer.responsive !== null);
    const sharedRuleValue = (field: "maxWidth" | "padding") => {
      const first = g.responsive?.[field];
      return first !== undefined &&
        allHaveRules &&
        current.every((layer) => layer.responsive?.[field] === first)
        ? first
        : null;
    };
    const breakpoint = sharedRuleValue("maxWidth");
    const padding = sharedRuleValue("padding");
    const setRuleValue = (field: "maxWidth" | "padding", value: number) =>
      apply((o) => ({
        ...o,
        responsive: { ...(o.responsive ?? defaultRule), [field]: value },
      }));
    return (
      <Section
        title="Responsive"
        actions={action(
          "Add responsive rule",
          <IconPlus />,
          () =>
            apply((o) =>
              o.responsive ? o : { ...o, responsive: { ...defaultRule } },
            ),
          allHaveRules,
        )}
      >
        {hasRule && (
          <div className="design-property-inspector-responsive-rule">
            <Choice
              label="Breakpoint"
              value={breakpoint}
              values={[640, 768, 1024]}
              format={breakpointLabel}
              onChange={(value) => setRuleValue("maxWidth", value)}
            />
            {action("Remove responsive rule", <IconX />, () =>
              apply((o) => ({ ...o, responsive: null })),
            )}
            <Choice
              label="Responsive padding"
              value={padding}
              values={[8, 16, 24, 32]}
              format={(value) => `Padding ${value}px`}
              onChange={(value) => setRuleValue("padding", value)}
            />
            {breakpoint !== null && padding !== null && (
              <code>
                max-{breakpoints.get(breakpoint) ?? `[${breakpoint}px]`}:px-
                {padding / 4}
              </code>
            )}
          </div>
        )}
      </Section>
    );
  }
  function section(
    name: keyof NonNullable<typeof sections>,
    fallback: () => React.ReactNode,
  ) {
    return sections && Object.hasOwn(sections, name)
      ? sections[name]
      : fallback();
  }
  return (
    <DesignPropertyInspector
      className={className}
      aria-label={ariaLabel}
      collaboration={collaboration}
      selection={selectedHeader}
      selectionKey={selectionKey}
      readOnly={readOnly}
      component={instance}
      sections={{
        export: exportSection,
        ...sections,
        position: section("position", renderPosition),
        layout: section("layout", renderLayout),
        appearance: section("appearance", renderAppearance),
        fill: section("fill", renderFill),
        stroke: section("stroke", () =>
          propertyStyle("Stroke", "stroke", [1, 2, 4]),
        ),
        effects: section("effects", () =>
          propertyStyle("Effects", "shadow", [4, 12, 24]),
        ),
        responsive: section("responsive", renderResponsive),
      }}
    >
      {children}
    </DesignPropertyInspector>
  );
}
