import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  IconArrowBackUp,
  IconAngle,
  IconRadiusTopLeft,
  IconLayoutAlignLeft,
  IconLayoutAlignCenter,
  IconLayoutAlignRight,
  IconLayoutAlignTop,
  IconLayoutAlignMiddle,
  IconLayoutAlignBottom,
  IconRotateClockwise,
  IconFlipHorizontal,
  IconFlipVertical,
  IconEye,
  IconEyeOff,
  IconPlus,
  IconMinus,
  IconCode,
  IconComponents,
  IconGridDots,
  IconLayoutDistributeHorizontal,
  IconFrame,
  IconAlignLeft,
  IconAlignCenter,
  IconAlignRight,
  IconTypography,
} from "@tabler/icons-react";
import {
  useLayoutEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { expect, within } from "storybook/test";

import { IconButton } from "../../../src/ui/base-ui/button.js";
import { Heading } from "../../../src/ui/base-ui/heading.js";
import { Input, InputSlot } from "../../../src/ui/base-ui/input.js";
import {
  Inspector,
  InspectorHeader,
  InspectorField,
  InspectorGrid,
  InspectorSection,
  InspectorSectionHeader,
  InspectorContent,
} from "../../../src/ui/base-ui/inspector.js";
import {
  AutoLayoutControls,
  LayoutDimensions,
  resizeLayout,
  type AutoLayoutValue,
  type LayoutDimensionsValue,
  type PropertyEdit,
} from "../../../src/ui/base-ui/layout-properties.js";
import {
  NumberField,
  NumberFieldScrubArea,
} from "../../../src/ui/base-ui/number-field.js";
import {
  PaintEditor,
  paintBackground,
  type Paint,
  type PaintToken,
} from "../../../src/ui/base-ui/paint-editor.js";
import {
  PropertyTokenField,
  useTokenBinding,
  type PropertyBinding,
} from "../../../src/ui/base-ui/property-token.js";
import {
  SegmentedControl,
  SegmentedControlItem,
} from "../../../src/ui/base-ui/segmented-control.js";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectItem,
  SelectPopup,
} from "../../../src/ui/base-ui/select.js";
import { Toggle } from "../../../src/ui/base-ui/toggle.js";
import guide from "./inspector.docs.md?raw";
import { usePaintHistory } from "./use-paint-history.js";
const pictures = [
  new URL(
    "../../../../../templates/assets/public/library-presets/prismatic-paper-cut/kirigami.webp",
    import.meta.url,
  ).href,
  new URL(
    "../../../../../templates/assets/public/library-presets/prismatic-paper-cut/paper-rainbow.webp",
    import.meta.url,
  ).href,
  new URL(
    "../../../../../templates/assets/public/library-presets/prismatic-paper-cut/lords-prayer-cutout.webp",
    import.meta.url,
  ).href,
];
const radiusTokens = [
  { id: "tight", label: "Tight", value: 4 },
  { id: "rounded", label: "Rounded", value: 8 },
  { id: "pill", label: "Pill", value: 128 },
];
const frameTokens: PaintToken[] = [
  { id: "surface", label: "Surface", value: "var(--surface-raised)" },
  { id: "cool", label: "Cool", value: "var(--info-4)" },
  { id: "warm", label: "Warm", value: "var(--warning-4)" },
];
const initialPaint: readonly Paint[] = [
  {
    id: "nav-background",
    kind: "solid",
    opacity: 100,
    visible: true,
    color: { token: "surface", value: "white" },
  },
];
function Section({
  title,
  actions,
  children,
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <InspectorSection>
      <InspectorSectionHeader>
        <h3 className="text-xs font-semibold">{title}</h3>
        {actions}
      </InspectorSectionHeader>
      <InspectorContent>{children}</InspectorContent>
    </InspectorSection>
  );
}
function GroupRow({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  return (
    <InspectorField>
      <span id={id}>{label}</span>
      <div role="group" aria-labelledby={id}>
        {children}
      </div>
    </InspectorField>
  );
}
function Numeric({
  label,
  symbol,
  value,
  onChange,
  max = 100,
  min = 0,
}: {
  label: string;
  symbol: string;
  value: number | null;
  onChange: (value: number | null) => void;
  min?: number;
  max?: number;
}) {
  return (
    <NumberField
      aria-label={label}
      value={value}
      onValueChange={onChange}
      min={min}
      max={max}
    >
      <NumberFieldScrubArea>{symbol}</NumberFieldScrubArea>
    </NumberField>
  );
}
function Measure({
  name,
  value,
  change,
  unit,
  prefix,
  min = 0,
  max = 1024,
}: {
  name: string;
  value: number;
  change: (value: number) => void;
  unit?: string;
  prefix?: ReactNode;
  min?: number;
  max?: number;
}) {
  const id = useId();
  return (
    <InspectorField>
      <label className="sr-only" htmlFor={id}>
        {name}
      </label>
      <NumberField
        id={id}
        value={value}
        unit={unit}
        min={min}
        max={max}
        onValueChange={(next) => {
          if (next !== null) change(next);
        }}
      >
        <InputSlot side="left">{prefix ?? name}</InputSlot>
      </NumberField>
    </InspectorField>
  );
}

const sizeLimits = { min: 32, max: 640 };
const defaultLayout: AutoLayoutValue & LayoutDimensionsValue = {
  width: 448,
  height: 32,
  aspectRatio: null,
  mode: "row",
  alignment: { justify: "start", align: "center" },
  grid: { columns: 2, rows: "auto" },
  gap: 12,
  paddingX: 16,
  paddingY: 0,
  wrap: false,
  clip: true,
};
const navItems = [
  "Agent-Native",
  "Product",
  "Pricing",
  "Docs",
  "Changelog",
  "Log in",
];

function FrameInspector({ initialAuto = false }: { initialAuto?: boolean }) {
  const frame = useRef<HTMLDivElement>(null);
  const [fixed, setFixed] = useState<
    { left: number; top: number; width: number; height: number }[] | null
  >(null);
  const [layout, setLayout] = useState(defaultLayout);
  const [preview, setPreview] = useState<Partial<typeof layout> | null>(null);
  const {
    mode,
    alignment,
    grid,
    width,
    height,
    gap,
    paddingX: padX,
    paddingY: padY,
    wrap,
    clip,
    aspectRatio,
  } = { ...layout, ...preview };
  function editLayout(edit: PropertyEdit<Partial<typeof layout>>) {
    if (edit.phase === "preview") {
      setPreview(edit.value);
      return;
    }
    setPreview(null);
    if (edit.phase === "commit")
      setLayout((current) => ({ ...current, ...edit.value }));
  }
  const [x, setX] = useState(0),
    [y, setY] = useState(0);
  const [radius, setRadius] = useState<PropertyBinding<number>>({ value: 0 }),
    [opacity, setOpacity] = useState(100);
  const radiusBinding = useTokenBinding(radius, radiusTokens, setRadius);
  const fill = usePaintHistory(initialPaint);
  const portal = useRef<HTMLDivElement>(null);
  const [angle, setAngle] = useState(0),
    [flipX, setFlipX] = useState(false),
    [flipY, setFlipY] = useState(false);
  const [visible, setVisible] = useState(true),
    [stroke, setStroke] = useState(false),
    [shadow, setShadow] = useState(false),
    [code, setCode] = useState(false);
  const [login, setLogin] = useState(true);
  const [previewState, setPreviewState] = useState("Default");
  const auto = fixed === null;
  useLayoutEffect(() => {
    if (!initialAuto) toggleAuto(false);
  }, [initialAuto]);
  function toggleAuto(enabled: boolean) {
    if (enabled) setFixed(null);
    else if (frame.current)
      setFixed(
        Array.from(frame.current.children, (child) => {
          const box = child as HTMLElement;
          return {
            left: box.offsetLeft,
            top: box.offsetTop,
            width: box.offsetWidth,
            height: box.offsetHeight,
          };
        }),
      );
  }
  return (
    <div
      ref={portal}
      className="grid min-h-screen bg-surface-sunken md:grid-cols-[minmax(0,1fr)_280px]"
    >
      <div className="flex min-h-56 min-w-0 justify-center items-start overflow-hidden px-4 pt-12">
        <article className="w-[448px] max-w-full bg-surface-raised shadow-sm">
          <div
            style={{
              width,
              maxWidth: "100%",
              transform: "translate(" + x + "px," + y + "px)",
            }}
            className="relative z-10 outline outline-1 outline-[var(--line-focus)]"
          >
            <span className="absolute bottom-full mb-1 rounded-sm bg-[var(--accent-solid)] px-1 text-[10px] text-[var(--accent-contrast)]">
              Nav
            </span>
            <div
              ref={frame}
              role="group"
              aria-label="Nav frame preview"
              className="relative"
              style={{
                display: auto ? (mode === "grid" ? "grid" : "flex") : "block",
                flexDirection: mode === "column" ? "column" : "row",
                flexWrap: wrap ? "wrap" : "nowrap",
                gridTemplateColumns:
                  "repeat(" + grid.columns + ", minmax(0,1fr))",
                gridTemplateRows:
                  grid.rows === "auto"
                    ? undefined
                    : "repeat(" + grid.rows + ",1fr)",
                justifyContent: alignment.justify,
                alignItems: mode === "grid" ? "center" : alignment.align,
                width,
                maxWidth: "100%",
                height,
                transform:
                  "rotate(" +
                  angle +
                  "deg) scale(" +
                  (flipX ? -1 : 1) +
                  "," +
                  (flipY ? -1 : 1) +
                  ")",
                visibility: visible ? "visible" : "hidden",
                border: stroke ? "1px solid var(--fg-muted)" : undefined,
                outline:
                  previewState === "Focus"
                    ? "2px solid var(--line-focus)"
                    : undefined,
                filter:
                  previewState === "Hover" ? "brightness(.96)" : undefined,
                boxShadow: shadow ? "var(--shadow-3)" : undefined,
                padding: padY + "px " + padX + "px",
                gap,
                borderRadius: radiusBinding.resolved,
                opacity: opacity / 100,
                backgroundImage: paintBackground(fill.paints, frameTokens),
                overflow: clip ? "hidden" : "visible",
              }}
            >
              {navItems.map((item, index) => (
                <span
                  key={item}
                  className={
                    index === 0
                      ? "mr-auto text-[10px] font-bold"
                      : "text-[9px] text-fg-muted"
                  }
                  style={{
                    ...(fixed ? { position: "absolute", ...fixed[index] } : {}),
                    visibility:
                      item === "Log in" && !login ? "hidden" : undefined,
                  }}
                >
                  {item}
                </span>
              ))}
            </div>
            {[
              "-left-0.5 -top-0.5",
              "-right-0.5 -top-0.5",
              "-left-0.5 -bottom-0.5",
              "-right-0.5 -bottom-0.5",
            ].map((corner) => (
              <i
                key={corner}
                aria-hidden
                className={
                  "pointer-events-none absolute size-1 border border-[var(--line-focus)] bg-surface-raised " +
                  corner
                }
              />
            ))}
          </div>
          <div className="px-5 pb-12 text-center">
            <div className="mx-auto max-w-72 py-10">
              <h2 className="text-[28px] font-bold leading-[1.02] tracking-tight">
                The app framework your agent can actually use.
              </h2>
              <p className="mt-3 text-[9px] text-fg-muted">
                Agent-Native runs every app you build on a typed set of actions,
                a shared SQL layer, and a workspace your agent can see.
              </p>
              <div className="mt-4 flex justify-center gap-2 text-[9px]">
                <span className="rounded-full bg-fg px-3 py-1 text-surface-raised">
                  Start building free
                </span>
                <span className="rounded-full border border-line px-3 py-1">
                  Read the docs
                </span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 text-left">
              {[
                ["Scaffold", "One command to a running agent-native app."],
                ["Actions, not endpoints", "Every capability is an action."],
              ].map(([label, title]) => (
                <div key={label} className="rounded-lg bg-surface-sunken p-3">
                  <small className="text-[7px] uppercase tracking-wide text-fg-muted">
                    {label}
                  </small>
                  <h3 className="mt-1 text-xs font-semibold">{title}</h3>
                </div>
              ))}
            </div>
            <h3 className="my-16 text-xl font-semibold tracking-tight">
              One action. Two callers.
            </h3>
          </div>
        </article>
      </div>
      <Inspector
        aria-label="Frame properties"
        className="min-w-0 border-s border-line bg-surface-nav md:h-screen md:overflow-y-auto"
      >
        <InspectorHeader>
          <Heading
            as="h2"
            textStyle="label-large"
            className="flex items-center gap-2"
          >
            <IconFrame size={16} aria-hidden />
            div
          </Heading>
          <Toggle
            color="gray"
            aria-label="View code"
            title="View code"
            pressed={code}
            onPressedChange={setCode}
          >
            <IconCode />
          </Toggle>
        </InspectorHeader>
        {code && (
          <Section title="Code">
            <code className="text-xs">
              {'<div style="width:' +
                width +
                "px;height:" +
                height +
                "px;display:" +
                (auto ? (mode === "grid" ? "grid" : "flex") : "block") +
                '">'}
            </code>
          </Section>
        )}
        <InspectorSection>
          <InspectorSectionHeader>
            <span className="flex items-center gap-2 text-xs font-medium text-[var(--accent-text)]">
              <IconComponents size={14} />
              Nav
            </span>
          </InspectorSectionHeader>
          <SegmentedControl
            className="w-full"
            aria-label="Log in"
            value={login ? "on" : "off"}
            onValueChange={(v) => setLogin(v === "on")}
          >
            <SegmentedControlItem value="on">On</SegmentedControlItem>
            <SegmentedControlItem value="off">Off</SegmentedControlItem>
          </SegmentedControl>
          <div className="mt-4 pe-2">
            <Select
              aria-label="Preview state"
              value={previewState}
              onValueChange={(v) => {
                if (v) setPreviewState(v);
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectPopup>
                {["Default", "Hover", "Focus"].map((state) => (
                  <SelectItem key={state} value={state}>
                    {state}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </div>
        </InspectorSection>
        <Section
          title="Position"
          actions={
            <Toggle
              className="me-1"
              aria-label="Auto layout"
              title="Auto layout"
              pressed={auto}
              onPressedChange={toggleAuto}
            >
              <IconLayoutDistributeHorizontal aria-hidden />
            </Toggle>
          }
        >
          <div className="grid grid-cols-2 gap-2 pe-2">
            {[
              [
                IconLayoutAlignLeft,
                IconLayoutAlignCenter,
                IconLayoutAlignRight,
              ],
              [
                IconLayoutAlignTop,
                IconLayoutAlignMiddle,
                IconLayoutAlignBottom,
              ],
            ].map((icons, axis) => (
              <SegmentedControl
                key={axis}
                aria-label={
                  axis ? "Vertical alignment" : "Horizontal alignment"
                }
                disabled
              >
                {icons.map((Glyph, i) => (
                  <SegmentedControlItem
                    key={i}
                    value={String(i)}
                    aria-label={
                      (axis
                        ? ["Align top", "Align middle", "Align bottom"]
                        : ["Align left", "Align center", "Align right"])[i]
                    }
                  >
                    <Glyph />
                  </SegmentedControlItem>
                ))}
              </SegmentedControl>
            ))}
          </div>
          <InspectorGrid>
            <Measure name="X" value={x} change={setX} min={-200} max={200} />
            <Measure name="Y" value={y} change={setY} min={-200} max={200} />
          </InspectorGrid>
          <div className="grid grid-cols-2 gap-2 pe-2">
            <Measure
              name="Rotation"
              prefix={<IconAngle />}
              value={angle}
              change={setAngle}
              min={-360}
              max={360}
              unit="degree"
            />
            <div className="flex justify-around rounded-control bg-fill-neutral">
              <IconButton
                variant="ghost"
                color="gray"
                aria-label="Rotate 90 degrees"
                onClick={() => setAngle((angle + 90) % 360)}
              >
                <IconRotateClockwise />
              </IconButton>
              <Toggle
                color="gray"
                pressed={flipX}
                onPressedChange={setFlipX}
                aria-label="Flip horizontal"
              >
                <IconFlipHorizontal />
              </Toggle>
              <Toggle
                color="gray"
                pressed={flipY}
                onPressedChange={setFlipY}
                aria-label="Flip vertical"
              >
                <IconFlipVertical />
              </Toggle>
            </div>
          </div>
        </Section>
        <Section title="Layout">
          <LayoutDimensions
            width={width}
            height={height}
            locked={aspectRatio !== null}
            limits={sizeLimits}
            onLockChange={(on) =>
              editLayout({
                phase: "commit",
                value: { aspectRatio: on ? width / height : null },
              })
            }
            onEdit={(edit) => {
              if (edit.phase === "cancel") {
                editLayout(edit);
                return;
              }
              const next = resizeLayout(layout, edit.value, sizeLimits);
              editLayout({
                phase: edit.phase,
                value: { width: next.width, height: next.height },
              });
            }}
          />
          {auto && (
            <AutoLayoutControls
              value={{ ...layout, ...preview }}
              onEdit={editLayout}
              spacingLimits={{ max: 128 }}
            />
          )}
        </Section>
        <Section
          title="Appearance"
          actions={
            <Toggle
              color="gray"
              aria-label="Layer visible"
              pressed={visible}
              onPressedChange={setVisible}
            >
              {visible ? <IconEye /> : <IconEyeOff />}
            </Toggle>
          }
        >
          <InspectorGrid>
            <Measure
              name="Opacity"
              prefix={<IconGridDots />}
              unit="percent"
              value={opacity}
              change={setOpacity}
              max={100}
            />
            <PropertyTokenField
              label="Corner radius token"
              binding={radiusBinding}
              prefix={<IconRadiusTopLeft />}
              format={(n) => n + "px"}
              container={portal}
            >
              <Measure
                name="Corner radius"
                prefix={<IconRadiusTopLeft />}
                value={radiusBinding.resolved}
                change={(value) => setRadius({ value })}
                max={128}
              />
            </PropertyTokenField>
          </InspectorGrid>
        </Section>
        <PaintEditor
          value={fill.paints}
          onValueChange={fill.edit}
          onCancelPreview={fill.cancel}
          tokens={frameTokens}
          container={portal}
          headerActions={
            <IconButton
              type="button"
              variant="ghost"
              color="gray"
              aria-label="Undo paint edit"
              title="Undo paint edit"
              disabled={!fill.canUndo}
              onClick={fill.undo}
            >
              <IconArrowBackUp />
            </IconButton>
          }
        />

        <InspectorSectionHeader className="border-t border-line px-4">
          <h3 className="text-xs font-semibold">Stroke</h3>
          <Toggle
            color="gray"
            aria-label="Stroke"
            pressed={stroke}
            onPressedChange={setStroke}
          >
            {stroke ? <IconMinus /> : <IconPlus />}
          </Toggle>
        </InspectorSectionHeader>
        <InspectorSectionHeader className="border-y border-line px-4">
          <h3 className="text-xs font-semibold">Effects</h3>
          <Toggle
            color="gray"
            aria-label="Drop shadow"
            pressed={shadow}
            onPressedChange={setShadow}
          >
            {shadow ? <IconMinus /> : <IconPlus />}
          </Toggle>
        </InspectorSectionHeader>
      </Inspector>
    </div>
  );
}
export default {
  title: "Patterns/Inspector",
  parameters: { docs: { description: { component: guide } } },
  component: Inspector,
} satisfies Meta;
const editorStage = { layout: "fullscreen", stage: "editor" };
export const DesignFrame: StoryObj = {
  parameters: editorStage,
  render: () => <FrameInspector />,
};
export const AutoLayout: StoryObj = {
  parameters: editorStage,
  render: () => <FrameInspector initialAuto />,
};
export const KeyboardEditing: StoryObj = {
  parameters: editorStage,
  render: () => <FrameInspector initialAuto />,
  play: async ({ canvas, userEvent }) => {
    const frame = canvas.getByRole("group", { name: "Nav frame preview" });
    const toggle = canvas.getByRole("button", { name: "Auto layout" });
    await userEvent.click(canvas.getByRole("button", { name: "Vertical" }));
    const group = canvas.getByRole("radiogroup", { name: "Frame alignment" });
    await userEvent.click(
      within(group).getByRole("radio", { name: "Bottom right" }),
    );
    await expect(frame).toHaveStyle({
      flexDirection: "column",
      justifyContent: "end",
      alignItems: "end",
    });
    toggle.focus();
    await userEvent.keyboard(" ");
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await expect(group).not.toBeInTheDocument();
    await expect(frame.firstElementChild).toHaveStyle({ position: "absolute" });
    await userEvent.keyboard("{Enter}");
    await expect(frame).toHaveStyle({
      display: "flex",
      flexDirection: "column",
      alignItems: "end",
    });
    await userEvent.click(canvas.getByRole("button", { name: "Grid" }));
    await expect(frame).toHaveStyle({ display: "grid" });
    await expect(
      canvas.queryByRole("radiogroup", { name: "Frame alignment" }),
    ).not.toBeInTheDocument();
  },
};

const fonts = [
  { label: "Geist", value: "Geist Variable, sans-serif" },
  { label: "Inter", value: "Inter Variable, sans-serif" },
  { label: "System serif", value: "ui-serif, Georgia, serif" },
];
const weights = [
  { label: "Regular", value: "400" },
  { label: "Medium", value: "500" },
  { label: "Bold", value: "700" },
];
const textAlignments = [
  { value: "left", Icon: IconAlignLeft },
  { value: "center", Icon: IconAlignCenter },
  { value: "right", Icon: IconAlignRight },
] as const;

function Choice({
  label,
  items,
  value,
  onChange,
}: {
  label: string;
  items: { label: string; value: string }[];
  value: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <InspectorField>
      <label id={id + "-label"} htmlFor={id}>
        {label}
      </label>
      <Select
        aria-labelledby={id + "-label"}
        items={items}
        value={value}
        onValueChange={(next) => {
          if (next !== null) onChange(next);
        }}
      >
        <SelectTrigger id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectPopup>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
    </InspectorField>
  );
}

const lineHeights = [
  { id: "tight", label: "Tight", value: 105 },
  { id: "normal", label: "Normal", value: 150 },
  { id: "relaxed", label: "Relaxed", value: 160 },
];
function TypeInspector({
  boundLeading = false,
}: { boundLeading?: boolean } = {}) {
  const [family, setFamily] = useState("ui-serif, Georgia, serif");
  const [weight, setWeight] = useState("400");
  const [size, setSize] = useState<number | null>(54);
  const [leading, setLeading] = useState<PropertyBinding<number | null>>(
    boundLeading ? { token: "normal", value: 150 } : { value: 105 },
  );
  const leadingBinding = useTokenBinding(leading, lineHeights, setLeading);
  const [tracking, setTracking] = useState<number | null>(-2);
  const [alignment, setAlignment] = useState<"left" | "center" | "right">(
    "left",
  );
  const [copy, setCopy] = useState("Studies in paper");
  const nameId = useId();
  return (
    <div className="grid items-start gap-2 rounded-card border border-line bg-surface-sunken p-2 md:grid-cols-[minmax(0,1fr)_280px]">
      <div className="grid min-h-72 place-items-center bg-surface-sunken p-6">
        <div className="w-full max-w-96 overflow-hidden rounded-card bg-surface-raised shadow-sm">
          <img
            src={pictures[0]}
            alt=""
            className="aspect-[2/1] w-full object-cover"
          />
          <p
            data-testid="type-preview"
            className="p-5 [overflow-wrap:anywhere]"
            style={{
              fontFamily: family,
              fontWeight: weight,
              fontSize: size ?? undefined,
              lineHeight:
                leadingBinding.resolved === null
                  ? undefined
                  : leadingBinding.resolved / 100,
              letterSpacing: tracking === null ? undefined : tracking + "px",
              textAlign: alignment,
            }}
          >
            {copy}
          </p>
        </div>
      </div>
      <Inspector
        aria-label="Text properties"
        className="rounded-xl shadow-sm ring-1 ring-line"
      >
        <InspectorHeader>
          <Heading
            as="h2"
            textStyle="title-small"
            className="flex items-center gap-2"
          >
            <IconTypography size={16} aria-hidden />
            Text layer
          </Heading>
        </InspectorHeader>
        <Section title="Typography">
          <InspectorGrid>
            <InspectorField className="col-span-2">
              <label htmlFor={nameId}>Content</label>
              <Input
                id={nameId}
                value={copy}
                onChange={(event) => setCopy(event.target.value)}
              />
            </InspectorField>
          </InspectorGrid>
          <InspectorGrid>
            <Choice
              label="Family"
              items={fonts}
              value={family}
              onChange={setFamily}
            />
            <Choice
              label="Weight"
              items={weights}
              value={weight}
              onChange={setWeight}
            />
          </InspectorGrid>
          <InspectorGrid>
            <GroupRow label="Font size">
              <Numeric
                label="Font size"
                symbol="px"
                value={size}
                onChange={setSize}
                min={8}
                max={160}
              />
            </GroupRow>
            <GroupRow label="Line height">
              <PropertyTokenField
                binding={leadingBinding}
                label="Line height token"
                format={(n) => n + "%"}
              >
                <Numeric
                  label="Line height"
                  symbol="%"
                  value={leadingBinding.resolved}
                  onChange={(value) => setLeading({ value })}
                  min={50}
                  max={240}
                />
              </PropertyTokenField>
            </GroupRow>
          </InspectorGrid>
          <InspectorGrid>
            <GroupRow label="Letter spacing">
              <Numeric
                label="Letter spacing"
                symbol="px"
                value={tracking}
                onChange={setTracking}
                min={-8}
                max={32}
              />
            </GroupRow>
            <GroupRow label="Align">
              <SegmentedControl
                aria-label="Text alignment"
                value={alignment}
                onValueChange={(next) => {
                  const selected = textAlignments.find(
                    (item) => item.value === next,
                  );
                  if (selected) setAlignment(selected.value);
                }}
              >
                {textAlignments.map(({ value, Icon }) => (
                  <SegmentedControlItem
                    key={value}
                    value={value}
                    aria-label={"Align " + value}
                  >
                    <Icon aria-hidden />
                  </SegmentedControlItem>
                ))}
              </SegmentedControl>
            </GroupRow>
          </InspectorGrid>
        </Section>
      </Inspector>
    </div>
  );
}
export const LineHeightToken: StoryObj = {
  render: () => <TypeInspector boundLeading />,
};
export const TextLayer: StoryObj = { render: () => <TypeInspector /> };
export const EditTypography: StoryObj = {
  render: () => <TypeInspector />,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("combobox", { name: "Weight" }));
    await userEvent.click(
      await within(document.body).findByRole("option", { name: "Bold" }),
    );
    const text = canvas.getByTestId("type-preview");
    await expect(text).toHaveStyle({ fontWeight: "700" });
    await userEvent.click(canvas.getByRole("button", { name: "Align center" }));
    await expect(text).toHaveStyle({ textAlign: "center" });
  },
};

export const RadiusToken: StoryObj = {
  ...DesignFrame,
  play: async ({ canvas, canvasElement, userEvent }) => {
    const page = within(canvasElement.ownerDocument.body);
    const trigger = canvas.getByRole("combobox", {
      name: "Corner radius token",
    });
    await userEvent.click(trigger);
    await userEvent.click(await page.findByRole("option", { name: /Rounded/ }));
    await expect(trigger.querySelector(".badge")).toHaveTextContent("Rounded");
    await expect(
      canvas.getByRole("group", { name: "Nav frame preview" }),
    ).toHaveStyle({ borderRadius: "8px" });
    trigger.focus();
    await userEvent.keyboard("{Backspace}");
    await expect(
      canvas.getByRole("textbox", { name: "Corner radius" }),
    ).toHaveValue("8");
  },
};
