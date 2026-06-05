import { Fragment, type CSSProperties, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import type {
  PlanDiagramBlock,
  PlanLegacyWireframeBlock,
  PlanWireframeBlock,
  PlanWireframeNode,
  PlanWireframeSurface,
  PlanWireframeTone,
} from "@shared/plan-content";
import { LegacyRegionWireframe } from "./LegacyRegionWireframe";

/**
 * Wireframe renderer.
 *
 * PRIMARY PATH — declarative KIT TREE. The model emits a geometry-free tree of
 * semantic primitives (`{ el, ...props, children }`); this renderer maps each
 * node to a flex kit component and lays everything out with flexbox. The whole
 * artboard is wrapped in a single `Screen` that applies ONE coherent wobble
 * filter (`var(--wobble)`) — no per-box rough.js. Quality (fonts, density,
 * accent, spacing, footprint, the wobble) is owned ENTIRELY by the renderer and
 * the `:root` CSS-var token system; the model never emits CSS or coordinates.
 *
 * LEGACY PATH — region fallback. Old / imported plans carry coordinate regions
 * (`{ viewport, template, regions[] }`). Those are delegated to
 * `LegacyRegionWireframe` so they keep rendering. New generation never emits
 * regions. Do NOT delete the fallback; do NOT lossily migrate old plans.
 *
 * INTEGRATION NOTE: per the plan the kit primitives also live at
 * `wireframe/kit/*` (built in parallel) and the design tokens / `--wobble`
 * filter belong on `:root` (WS1.2/1.3). This file ships a self-contained kit +
 * an inline `<WobbleFilter>` so the renderer is correct and build-safe even
 * before that CSS lands. When the shared kit + `:root` tokens are in, the inline
 * primitives below can be swapped for imports from `./kit` and the inline filter
 * dropped — the node→component mapping (`renderNode`) is the stable contract.
 */

/* -------------------------------------------------------------------------- */
/* Surface presets — fixed-size static artboards (never scroll regions)       */
/* -------------------------------------------------------------------------- */

type SurfacePreset = {
  width: number;
  height: number;
  radius: number;
  /** Outer chrome: a phone gets a rounded slab; browser/desktop a window. */
  chrome: "phone" | "window" | "plain";
};

const SURFACE_PRESETS: Record<PlanWireframeSurface, SurfacePreset> = {
  mobile: { width: 300, height: 624, radius: 30, chrome: "phone" },
  desktop: { width: 840, height: 520, radius: 12, chrome: "window" },
  browser: { width: 840, height: 520, radius: 12, chrome: "window" },
  popover: { width: 360, height: 440, radius: 14, chrome: "plain" },
  panel: { width: 380, height: 560, radius: 14, chrome: "plain" },
};

/* -------------------------------------------------------------------------- */
/* CSS-var token bridge                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Token vars consumed by the kit. These mirror the `:root` token system from
 * WS1.2 (`--ink`, `--paper`, `--accent`, …). Until that lands globally, we seed
 * fallbacks on the artboard so the kit renders correctly. The kit always reads
 * the var (renderer-owned), never a hardcoded color.
 */
const KIT_VAR_FALLBACKS: CSSProperties = {
  // intent tokens (semantic; renderer maps to color)
  ["--wf-ink" as string]: "var(--ink, hsl(28 8% 18%))",
  ["--wf-soft" as string]: "var(--ink-soft, hsl(28 5% 58%))",
  ["--wf-line" as string]: "var(--line, hsl(38 12% 84%))",
  ["--wf-paper" as string]: "var(--paper, hsl(40 30% 98%))",
  ["--wf-card" as string]: "var(--card-bg, #ffffff)",
  ["--wf-accent" as string]: "var(--accent, hsl(222 65% 54%))",
  ["--wf-accent-soft" as string]:
    "var(--accent-soft, color-mix(in srgb, var(--wf-accent) 15%, #fff))",
  ["--wf-warn" as string]: "var(--warn, hsl(12 50% 47%))",
  ["--wf-warn-soft" as string]:
    "var(--warn-soft, color-mix(in srgb, var(--wf-warn) 15%, #fff))",
  ["--wf-ok" as string]: "var(--ok, hsl(146 22% 45%))",
  // density / typography
  ["--wf-gap" as string]: "var(--wf-density-gap, 11px)",
  ["--wf-pad" as string]: "var(--wf-density-pad, 12px)",
  ["--wf-fs" as string]: "var(--wf-density-fs, 14px)",
  ["--wf-radius" as string]: "var(--wf-density-radius, 7px)",
  ["--wf-stroke" as string]: "var(--wf-density-stroke, 1.4px)",
  ["--wf-font-hand" as string]:
    'var(--wf-hand-font, "Virgil", "Comic Sans MS", "Bradley Hand", cursive)',
  ["--wf-font-script" as string]:
    'var(--wf-script-font, "Caveat", "Virgil", cursive)',
};

const V = {
  ink: "var(--wf-ink)",
  soft: "var(--wf-soft)",
  line: "var(--wf-line)",
  paper: "var(--wf-paper)",
  card: "var(--wf-card)",
  accent: "var(--wf-accent)",
  accentSoft: "var(--wf-accent-soft)",
  warn: "var(--wf-warn)",
  warnSoft: "var(--wf-warn-soft)",
  ok: "var(--wf-ok)",
  stroke: "var(--wf-stroke)",
  radius: "var(--wf-radius)",
  gap: "var(--wf-gap)",
  pad: "var(--wf-pad)",
  fs: "var(--wf-fs)",
  hand: "var(--wf-font-hand)",
  script: "var(--wf-font-script)",
};

function toneColor(tone: PlanWireframeTone | undefined): string {
  switch (tone) {
    case "accent":
      return V.accent;
    case "warn":
      return V.warn;
    case "ok":
      return V.ok;
    case "muted":
      return V.soft;
    default:
      return V.ink;
  }
}

/* -------------------------------------------------------------------------- */
/* Public entry — universal renderer (kit tree primary, legacy fallback)      */
/* -------------------------------------------------------------------------- */

type WireframeData =
  | PlanWireframeBlock["data"]
  | PlanLegacyWireframeBlock["data"];

function isKitTreeData(
  data: WireframeData,
): data is PlanWireframeBlock["data"] {
  return Array.isArray((data as PlanWireframeBlock["data"]).screen);
}

/**
 * Universal wireframe entry. Detects the data shape:
 * - kit tree (`{ surface, screen }`) → the new flex renderer (primary).
 * - legacy regions (`{ regions, … }`) → the region fallback.
 *
 * `compact` and `canvasSize` are the stable props the document + canvas pass.
 */
export function Wireframe({
  data,
  compact,
  canvasSize,
}: {
  data: WireframeData;
  compact?: boolean;
  canvasSize?: number;
}) {
  if (isKitTreeData(data)) {
    return (
      <KitWireframe data={data} compact={compact} canvasSize={canvasSize} />
    );
  }
  return (
    <LegacyRegionWireframe
      data={data}
      compact={compact}
      canvasSize={canvasSize}
    />
  );
}

/** Convenience wrapper used by the document block dispatcher. */
export function KitWireframeBlock({
  block,
  compact,
}: {
  block: PlanWireframeBlock;
  compact?: boolean;
}) {
  return <Wireframe data={block.data} compact={compact} />;
}

/**
 * Inline kit-tree preview used by document blocks / option cards. Renders the
 * kit-tree `data` directly (compact by default) with an optional wrapper class.
 */
export function KitWireframePreview({
  data,
  compact = true,
  className,
}: {
  data: PlanWireframeBlock["data"];
  compact?: boolean;
  className?: string;
}) {
  return (
    <div className={className}>
      <KitWireframe data={data} compact={compact} />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Kit-tree renderer                                                          */
/* -------------------------------------------------------------------------- */

let wobbleFilterSeq = 0;

function KitWireframe({
  data,
  compact,
  canvasSize,
}: {
  data: PlanWireframeBlock["data"];
  compact?: boolean;
  canvasSize?: number;
}) {
  const preset = SURFACE_PRESETS[data.surface] ?? SURFACE_PRESETS.desktop;
  const height = canvasSize ?? preset.height;
  // Compact inline previews scale the artboard down without touching internals.
  const scale = compact ? Math.min(1, 320 / preset.width) : 1;

  return (
    <div
      className="plan-kit-wireframe"
      style={{
        width: compact ? preset.width * scale : "100%",
        maxWidth: preset.width,
      }}
    >
      <div
        style={{
          width: compact ? preset.width * scale : "100%",
          maxWidth: preset.width,
          height: compact ? height * scale : undefined,
          aspectRatio: compact ? undefined : `${preset.width} / ${height}`,
          marginInline: "auto",
        }}
      >
        <div
          className="plan-kit-artboard relative"
          style={{
            width: preset.width,
            height,
            ...(scale !== 1
              ? { transform: `scale(${scale})`, transformOrigin: "top left" }
              : {}),
            ...(compact ? {} : { width: "100%", height: "100%" }),
            ...KIT_VAR_FALLBACKS,
          }}
        >
          <Screen radius={preset.radius} chrome={preset.chrome}>
            {data.screen.map((node, index) => (
              <Fragment key={node.id ?? index}>{renderNode(node)}</Fragment>
            ))}
          </Screen>
        </div>
      </div>
      {data.caption && (
        <p className="mt-2 text-center text-xs text-plan-muted">
          {data.caption}
        </p>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* node -> component registry                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Map a single kit-tree node to its flex kit component. This is the stable
 * contract integration relies on: extend here when the schema adds primitives.
 */
function renderNode(node: PlanWireframeNode): ReactNode {
  const children = node.children?.map((child, index) => (
    <Fragment key={child.id ?? index}>{renderNode(child)}</Fragment>
  ));

  switch (node.el) {
    case "screen":
      // Nested screen acts as a plain column wrapper.
      return <Col>{children}</Col>;
    case "browserBar":
      return <BrowserBar title={node.title ?? node.text} />;
    case "statusBar":
      return <StatusBar />;
    case "row":
      return <Row>{children}</Row>;
    case "col":
      return <Col>{children}</Col>;
    case "sidebar":
      return <Sidebar items={node.items}>{children}</Sidebar>;
    case "navItem":
      return (
        <NavItem
          label={node.label ?? node.text ?? ""}
          count={node.count}
          active={node.active}
          dot={node.dot}
        />
      );
    case "main":
      return <Main>{children}</Main>;
    case "title":
      return (
        <Title script={node.script} tone={node.color ?? node.tone}>
          {node.text ?? node.value ?? ""}
        </Title>
      );
    case "text":
      return (
        <Text tone={node.color ?? node.tone} weight={node.weight}>
          {node.value ?? node.text ?? ""}
        </Text>
      );
    case "lines":
      return <Lines n={node.n} widths={node.widths} />;
    case "section":
      return (
        <SectionLabel tone={node.tone}>{node.label ?? node.text}</SectionLabel>
      );
    case "taskRow":
      return (
        <TaskRow
          title={node.title ?? node.text ?? ""}
          note={node.note}
          due={node.due}
          dueTone={node.dueTone}
          prio={node.prio}
          done={node.done}
        />
      );
    case "chips":
      return <Chips items={node.items}>{children}</Chips>;
    case "chip":
      return <Chip active={node.active}>{node.label ?? node.text}</Chip>;
    case "pill":
      return <Pill tone={node.tone}>{node.label ?? node.text}</Pill>;
    case "check":
      return <Check done={node.done} shape={node.shape} />;
    case "field":
      return (
        <Field
          label={node.label}
          value={node.value}
          placeholder={node.placeholder}
          area={node.area}
        />
      );
    case "btn":
      return (
        <Btn solid={node.solid} full={node.full}>
          {node.label ?? node.text}
        </Btn>
      );
    case "fab":
      return <Fab icon={node.icon} />;
    case "card":
      return <Card>{children}</Card>;
    case "column":
      return (
        <Column title={node.title ?? node.text} count={node.count}>
          {children}
        </Column>
      );
    case "avatar":
      return <Avatar />;
    case "iconSquare":
      return <IconSquare active={node.active} />;
    case "kv":
      return <KV rows={node.rows} />;
    case "searchBar":
      return <SearchBar placeholder={node.placeholder ?? node.label} />;
    case "box":
      return <Box dashed={node.dashed}>{children}</Box>;
    case "divider":
      return <Divider />;
    default:
      return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Kit primitives (flex; read CSS vars; zero absolute except Fab)             */
/* -------------------------------------------------------------------------- */

function Screen({
  children,
  radius,
  chrome,
}: {
  children: ReactNode;
  radius: number;
  chrome: SurfacePreset["chrome"];
}) {
  const filterId = `wf-wobble-${(wobbleFilterSeq += 1)}`;
  return (
    <div
      className="relative h-full w-full overflow-hidden"
      style={{
        background: V.paper,
        color: V.ink,
        fontFamily: V.hand,
        fontSize: V.fs,
        lineHeight: 1.3,
        borderRadius: radius,
        border:
          chrome === "plain"
            ? `${V.stroke} solid ${V.line}`
            : `${V.stroke} solid ${V.ink}`,
        // ONE coherent wobble over the whole drawing. SVG filter attributes do
        // not accept CSS variables reliably, so keep the fallback numeric.
        filter: `var(--wobble, url(#${filterId}))`,
        display: "flex",
        flexDirection: "column",
        boxSizing: "border-box",
        boxShadow: "var(--wf-shadow, 0 10px 36px rgba(24,24,27,.12))",
      }}
    >
      <WobbleFilter id={filterId} />
      {chrome === "phone" && (
        <div
          aria-hidden
          style={{
            position: "absolute",
            top: 8,
            left: "50%",
            transform: "translateX(-50%)",
            width: 44,
            height: 5,
            borderRadius: 999,
            background: V.line,
            zIndex: 5,
          }}
        />
      )}
      {children}
    </div>
  );
}

/**
 * Inline single-filter wobble. Default scale is small/crisp; integration can
 * promote this to a shared `<WobbleFilter>` driven by a sketchiness slider
 * (`--wobble-scale`) and a global `:root` `--wobble` toggle.
 */
function WobbleFilter({ id }: { id: string }) {
  return (
    <svg
      aria-hidden
      width="0"
      height="0"
      style={{ position: "absolute", pointerEvents: "none" }}
    >
      <filter id={id}>
        <feTurbulence
          type="fractalNoise"
          baseFrequency="0.013"
          numOctaves={2}
          seed={7}
          result="noise"
        />
        <feDisplacementMap
          in="SourceGraphic"
          in2="noise"
          scale="1.2"
          xChannelSelector="R"
          yChannelSelector="G"
        />
      </filter>
    </svg>
  );
}

function Row({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        flex: 1,
        minHeight: 0,
        gap: V.gap,
      }}
    >
      {children}
    </div>
  );
}

function Col({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: V.gap,
        minHeight: 0,
      }}
    >
      {children}
    </div>
  );
}

function Sidebar({
  children,
  items,
}: {
  children?: ReactNode;
  items?: PlanWireframeNode["items"];
}) {
  return (
    <div
      style={{
        width: 196,
        flex: "0 0 auto",
        borderRight: `${V.stroke} solid ${V.line}`,
        background: V.card,
        padding: V.pad,
        display: "flex",
        flexDirection: "column",
        gap: V.gap,
        overflow: "hidden",
      }}
    >
      {items?.map((item, index) => (
        <NavItem
          key={index}
          label={item.label}
          count={item.count}
          active={item.active}
          dot={item.dot}
        />
      ))}
      {children}
    </div>
  );
}

function NavItem({
  label,
  count,
  active,
  dot,
}: {
  label: string;
  count?: number;
  active?: boolean;
  dot?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 9,
        padding: "5px 8px",
        borderRadius: V.radius,
        background: active ? V.accentSoft : "transparent",
      }}
    >
      {dot ? (
        <span
          style={{
            width: 10,
            height: 10,
            borderRadius: "50%",
            background: active ? V.accent : V.soft,
            flex: "0 0 auto",
          }}
        />
      ) : (
        <IconSquare active={active} size={15} />
      )}
      <span
        style={{
          flex: 1,
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          color: active ? V.accent : V.ink,
          fontWeight: active ? 700 : 400,
        }}
      >
        {label}
      </span>
      {count != null && (
        <span style={{ fontSize: "calc(var(--wf-fs) * 0.82)", color: V.soft }}>
          {count}
        </span>
      )}
    </div>
  );
}

function Main({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        padding: `calc(${V.pad} * 1.4) calc(${V.pad} * 1.8)`,
        display: "flex",
        flexDirection: "column",
        gap: V.gap,
        overflow: "hidden",
      }}
    >
      {children}
    </div>
  );
}

function Title({
  children,
  script,
  tone,
}: {
  children: ReactNode;
  script?: boolean;
  tone?: PlanWireframeTone;
}) {
  return (
    <span
      style={{
        fontFamily: script ? V.script : V.hand,
        fontSize: script
          ? "calc(var(--wf-fs) * 2.1)"
          : "calc(var(--wf-fs) * 1.4)",
        fontWeight: 700,
        lineHeight: 1.1,
        color: toneColor(tone),
      }}
    >
      {children}
    </span>
  );
}

function Text({
  children,
  tone,
  weight,
}: {
  children: ReactNode;
  tone?: PlanWireframeTone;
  weight?: "normal" | "medium" | "bold";
}) {
  return (
    <span
      style={{
        color: toneColor(tone),
        fontWeight: weight === "bold" ? 700 : weight === "medium" ? 600 : 400,
      }}
    >
      {children}
    </span>
  );
}

function Bar({ w = "80%", h }: { w?: number | string; h?: number | string }) {
  return (
    <div
      style={{
        width: w,
        height: h ?? "calc(var(--wf-fs) * 0.72)",
        background: V.line,
        borderRadius: 4,
        flex: "0 0 auto",
      }}
    />
  );
}

function Lines({ n = 2, widths }: { n?: number; widths?: number[] }) {
  const ws =
    widths && widths.length
      ? widths.map((w) => `${w}%`)
      : Array.from({ length: n }, (_, i) => (i === n - 1 ? "55%" : "100%"));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {ws.map((w, i) => (
        <Bar key={i} w={w} />
      ))}
    </div>
  );
}

function SectionLabel({
  children,
  tone,
}: {
  children: ReactNode;
  tone?: PlanWireframeTone;
}) {
  return (
    <span
      style={{
        fontSize: "calc(var(--wf-fs) * 0.86)",
        fontWeight: 700,
        letterSpacing: 0.3,
        color: tone ? toneColor(tone) : V.soft,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

function TaskRow({
  title,
  note,
  due,
  dueTone,
  prio,
  done,
}: {
  title: string;
  note?: string;
  due?: string;
  dueTone?: PlanWireframeTone;
  prio?: number;
  done?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: V.gap,
        padding: "calc(var(--wf-pad) * 0.5) 0",
      }}
    >
      <div style={{ marginTop: 1 }}>
        <Check done={done} />
      </div>
      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          gap: 4,
        }}
      >
        <span
          style={{
            color: done ? V.soft : V.ink,
            textDecoration: done ? "line-through" : "none",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {title}
        </span>
        {note && <Bar w="55%" />}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          flex: "0 0 auto",
        }}
      >
        {due && <Pill tone={dueTone}>{due}</Pill>}
        {prio != null && <Prio level={prio} />}
      </div>
    </div>
  );
}

function Prio({ level = 2 }: { level?: number }) {
  const fill = level === 1 ? V.warn : level === 2 ? V.soft : "transparent";
  const bd = level >= 3 ? V.soft : "transparent";
  return (
    <span
      style={{
        width: 9,
        height: 9,
        borderRadius: "50%",
        background: fill,
        border: `${V.stroke} solid ${bd}`,
        flex: "0 0 auto",
      }}
    />
  );
}

function Chips({
  children,
  items,
}: {
  children?: ReactNode;
  items?: PlanWireframeNode["items"];
}) {
  return (
    <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
      {items?.map((item, index) => (
        <Chip key={index} active={item.active}>
          {item.label}
        </Chip>
      ))}
      {children}
    </div>
  );
}

function Chip({ children, active }: { children: ReactNode; active?: boolean }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        border: `${V.stroke} solid ${active ? V.accent : V.ink}`,
        background: active ? V.accentSoft : "transparent",
        color: active ? V.accent : V.ink,
        borderRadius: 999,
        padding: "4px 12px",
        fontSize: "calc(var(--wf-fs) * 0.88)",
        fontWeight: active ? 700 : 400,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

function Pill({
  children,
  tone,
}: {
  children: ReactNode;
  tone?: PlanWireframeTone;
}) {
  const map: Record<
    "default" | "accent" | "warn" | "ok" | "muted",
    { bd: string; bg: string; fg: string }
  > = {
    default: { bd: V.ink, bg: "transparent", fg: V.ink },
    accent: { bd: V.accent, bg: V.accentSoft, fg: V.accent },
    warn: { bd: V.warn, bg: V.warnSoft, fg: V.warn },
    ok: { bd: V.ok, bg: "transparent", fg: V.ok },
    muted: { bd: V.soft, bg: "transparent", fg: V.soft },
  };
  const c = map[tone ?? "default"];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        border: `${V.stroke} solid ${c.bd}`,
        background: c.bg,
        color: c.fg,
        borderRadius: 999,
        padding: "2px 9px",
        fontSize: "calc(var(--wf-fs) * 0.82)",
        whiteSpace: "nowrap",
        lineHeight: 1.3,
      }}
    >
      {children}
    </span>
  );
}

function Check({
  done,
  shape = "square",
  size = 18,
}: {
  done?: boolean;
  shape?: "square" | "circle";
  size?: number;
}) {
  const r = shape === "circle" ? "50%" : "calc(var(--wf-radius) * 0.5)";
  return (
    <div
      style={{
        width: size,
        height: size,
        flex: "0 0 auto",
        borderRadius: r,
        border: `${V.stroke} solid ${done ? V.accent : V.ink}`,
        background: done ? V.accent : "transparent",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {done && (
        <svg
          width={size * 0.6}
          height={size * 0.6}
          viewBox="0 0 12 12"
          fill="none"
          stroke="#fff"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M2 6.5l2.5 2.5L10 3" />
        </svg>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  placeholder,
  area,
}: {
  label?: string;
  value?: string;
  placeholder?: string;
  area?: boolean;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      {label && (
        <span
          style={{
            fontSize: "calc(var(--wf-fs) * 0.86)",
            color: V.soft,
            fontWeight: 700,
          }}
        >
          {label}
        </span>
      )}
      <div
        style={{
          border: `${V.stroke} solid ${V.ink}`,
          borderRadius: V.radius,
          background: V.card,
          padding: "calc(var(--wf-pad) * 0.8)",
          minHeight: area ? 64 : undefined,
          display: "flex",
          alignItems: area ? "flex-start" : "center",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        {value ? (
          <span>{value}</span>
        ) : area ? (
          <Lines n={2} widths={[85, 60]} />
        ) : (
          <Bar w={placeholder ? 140 : 110} />
        )}
      </div>
    </div>
  );
}

function Btn({
  children,
  solid,
  full,
}: {
  children: ReactNode;
  solid?: boolean;
  full?: boolean;
}) {
  return (
    <div
      style={{
        display: full ? "flex" : "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        border: `${V.stroke} solid ${solid ? V.accent : V.ink}`,
        background: solid ? V.accent : "transparent",
        color: solid ? "#fff" : V.ink,
        borderRadius: V.radius,
        padding: "7px 14px",
        fontWeight: 700,
        width: full ? "100%" : "auto",
        boxSizing: "border-box",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </div>
  );
}

function Fab({ icon = "+" }: { icon?: string }) {
  return (
    <div
      style={{
        position: "absolute",
        right: 18,
        bottom: 22,
        width: 52,
        height: 52,
        borderRadius: "50%",
        border: `${V.stroke} solid ${V.accent}`,
        background: V.accent,
        color: "#fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 28,
        fontWeight: 700,
        lineHeight: 1,
        boxShadow: "0 4px 12px rgba(0,0,0,0.16)",
        zIndex: 4,
      }}
    >
      {icon}
    </div>
  );
}

function BrowserBar({ title = "app" }: { title?: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "9px 14px",
        borderBottom: `${V.stroke} solid ${V.ink}`,
        flex: "0 0 auto",
        background: V.card,
      }}
    >
      <div style={{ display: "flex", gap: 6 }}>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            style={{
              width: 11,
              height: 11,
              borderRadius: "50%",
              border: `${V.stroke} solid ${V.ink}`,
            }}
          />
        ))}
      </div>
      <div
        style={{
          flex: 1,
          border: `${V.stroke} solid ${V.soft}`,
          borderRadius: 999,
          padding: "3px 12px",
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <Bar w={12} h={10} />
        <span style={{ fontSize: "calc(var(--wf-fs) * 0.82)", color: V.soft }}>
          {title}.app
        </span>
      </div>
    </div>
  );
}

function StatusBar() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "9px 18px 2px",
        flex: "0 0 auto",
      }}
    >
      <span style={{ fontSize: "calc(var(--wf-fs) * 0.82)", fontWeight: 700 }}>
        9:41
      </span>
      <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
        <Bar w={16} h={8} />
        <Bar w={12} h={8} />
        <Bar w={20} h={9} />
      </div>
    </div>
  );
}

function Avatar({ size = 26 }: { size?: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        border: `${V.stroke} solid ${V.ink}`,
        background: V.accentSoft,
        flex: "0 0 auto",
      }}
    />
  );
}

function IconSquare({
  active,
  size = 18,
}: {
  active?: boolean;
  size?: number;
}) {
  return (
    <div
      style={{
        width: size,
        height: size,
        flex: "0 0 auto",
        borderRadius: "calc(var(--wf-radius) * 0.5)",
        border: `${V.stroke} solid ${active ? V.accent : V.soft}`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          width: "55%",
          height: "55%",
          borderRadius: 2,
          background: active ? V.accent : V.line,
        }}
      />
    </div>
  );
}

function SearchBar({ placeholder }: { placeholder?: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        border: `${V.stroke} solid ${V.soft}`,
        borderRadius: 999,
        padding: "5px 11px",
        background: V.card,
      }}
    >
      <Bar w={11} h={11} />
      <span style={{ fontSize: "calc(var(--wf-fs) * 0.85)", color: V.soft }}>
        {placeholder ?? "Search"}
      </span>
    </div>
  );
}

function Box({ children, dashed }: { children?: ReactNode; dashed?: boolean }) {
  return (
    <div
      style={{
        border: `${V.stroke} ${dashed ? "dashed" : "solid"} ${V.ink}`,
        borderRadius: V.radius,
        background: V.card,
        padding: V.pad,
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        gap: V.gap,
      }}
    >
      {children}
    </div>
  );
}

function Card({ children }: { children?: ReactNode }) {
  return <Box>{children}</Box>;
}

function Column({
  children,
  title,
  count,
}: {
  children?: ReactNode;
  title?: string;
  count?: number;
}) {
  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        gap: V.gap,
        background: V.card,
        border: `${V.stroke} solid ${V.line}`,
        borderRadius: V.radius,
        padding: V.pad,
      }}
    >
      {(title || count != null) && (
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            gap: 8,
          }}
        >
          {title && <span style={{ fontWeight: 700 }}>{title}</span>}
          {count != null && (
            <span
              style={{ fontSize: "calc(var(--wf-fs) * 0.82)", color: V.soft }}
            >
              {count}
            </span>
          )}
        </div>
      )}
      {children}
    </div>
  );
}

function KV({ rows }: { rows?: Array<{ k: string; v: string }> }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {rows?.map((row, index) => (
        <div
          key={index}
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <span style={{ color: V.soft }}>{row.k}</span>
          <span style={{ fontWeight: 600 }}>{row.v}</span>
        </div>
      ))}
    </div>
  );
}

function Divider() {
  return (
    <div
      style={{
        height: V.stroke,
        background: V.line,
        margin: "3px 0",
        flex: "0 0 auto",
      }}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* SketchDiagram — kept here; document + canvas import it from this module     */
/* -------------------------------------------------------------------------- */

export function SketchDiagram({
  data,
  compact,
}: {
  data: PlanDiagramBlock["data"];
  compact?: boolean;
}) {
  const nodes = orderDiagramNodes(data.nodes, data.edges);
  return (
    <div className="plan-sketch rounded-[16px] border border-plan-line bg-plan-wireframe p-5">
      <div
        className={cn(
          "flex gap-3 overflow-x-auto pb-2",
          compact ? "items-center" : "items-stretch",
        )}
      >
        {nodes.map((node, index) => {
          const next = nodes[index + 1];
          const edge = next
            ? data.edges.find(
                (candidate) =>
                  candidate.from === node.id && candidate.to === next.id,
              )
            : undefined;
          return (
            <div key={node.id} className="flex min-w-max items-center gap-3">
              <article
                className={cn(
                  "w-[180px] rounded-xl border-2 border-plan-sketch-line bg-plan-document p-3 text-plan-text",
                  compact && "w-[150px]",
                )}
              >
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-plan-muted">
                  {index + 1}
                </p>
                <h3 className="mt-2 text-base font-semibold leading-tight">
                  {node.label}
                </h3>
                {node.detail && !compact && (
                  <p className="mt-2 text-xs leading-5 text-plan-muted">
                    {node.detail}
                  </p>
                )}
              </article>
              {next && (
                <div className="grid min-w-[72px] justify-items-center gap-1 text-plan-muted">
                  {edge?.label && (
                    <span className="max-w-[96px] truncate rounded-full border border-plan-line px-2 py-0.5 text-[11px] font-semibold">
                      {edge.label}
                    </span>
                  )}
                  <span className="h-0.5 w-full rounded-full border-t-2 border-dashed border-plan-muted-line" />
                </div>
              )}
            </div>
          );
        })}
      </div>
      {data.notes && data.notes.length > 0 && !compact && (
        <div className="mt-4 grid gap-2 border-t border-plan-line pt-4 text-sm text-plan-muted md:grid-cols-2">
          {data.notes.map((note) => (
            <p key={note.id}>{note.text}</p>
          ))}
        </div>
      )}
    </div>
  );
}

function orderDiagramNodes(
  nodes: PlanDiagramBlock["data"]["nodes"],
  edges: PlanDiagramBlock["data"]["edges"],
) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const targets = new Set(edges.map((edge) => edge.to));
  const first = nodes.find((node) => !targets.has(node.id)) ?? nodes[0];
  if (!first) return nodes;

  const ordered = [first];
  const seen = new Set([first.id]);
  let current = first;
  while (current) {
    const nextEdge = edges.find(
      (edge) => edge.from === current.id && !seen.has(edge.to),
    );
    const next = nextEdge ? nodeById.get(nextEdge.to) : undefined;
    if (!next) break;
    ordered.push(next);
    seen.add(next.id);
    current = next;
  }

  for (const node of nodes) {
    if (!seen.has(node.id)) ordered.push(node);
  }
  return ordered;
}
