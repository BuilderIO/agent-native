import { type PlanWireframeTone } from "@shared/plan-content";
import {
  createContext,
  useContext,
  type CSSProperties,
  type ReactNode,
} from "react";

/** Default sketch level (0–100) → rough.js roughness. Legible but hand-drawn. */
export const DEFAULT_SKETCH = 40;

/**
 * Frame-level config threaded to every Screen (including ones the registry
 * builds for a top-level `screen` node), so skeleton / theme / sketch-vs-clean
 * reach the kit no matter which path renders the root Screen.
 */
export const KitConfigContext = createContext<{
  skeleton?: boolean;
  sketch?: number;
  theme?: "light" | "dark";
  style?: "sketchy" | "clean";
}>({});

/*
 * wf-kit — low-fi wireframe primitives (hand-drawn vibe), ported to React from
 * Claude's wf-kit.jsx. Every primitive reads CSS vars set by
 * plan-wireframe-tokens.css on the `.plan-wf` scope (density / accent / theme),
 * and the sketch wobble is an SVG filter applied at the Screen level so the
 * whole mock wobbles together like one drawing.
 *
 * Layout is ALWAYS flex — row/col/sidebar/main set the direction. Only Fab and
 * overlays use absolute positioning. These are the renderers for the
 * NODE_VOCAB nodes; see ./registry.tsx for the el -> component mapping.
 */

const V = {
  ink: "var(--ink)",
  soft: "var(--ink-soft)",
  line: "var(--line)",
  paper: "var(--paper)",
  card: "var(--card)",
  accent: "var(--accent)",
  accentSoft: "var(--accent-soft)",
  warn: "var(--warn)",
  warnSoft: "var(--warn-soft)",
  ok: "var(--ok)",
  okSoft: "var(--ok-soft)",
  stroke: "var(--stroke)",
  radius: "var(--radius)",
  gap: "var(--gap)",
  pad: "var(--pad)",
  fs: "var(--fs)",
  hand: "var(--font-hand)",
  script: "var(--font-script)",
} as const;

/** Map a semantic tone to its foreground / background / border colors. */
type ToneColors = { fg: string; bg: string; bd: string };

function toneColors(tone: PlanWireframeTone = "default"): ToneColors {
  switch (tone) {
    case "accent":
      return { fg: V.accent, bg: V.accentSoft, bd: V.accent };
    case "warn":
      return { fg: V.warn, bg: V.warnSoft, bd: V.warn };
    case "ok":
      return { fg: V.ok, bg: V.okSoft, bd: V.ok };
    case "muted":
      return { fg: V.soft, bg: "transparent", bd: V.soft };
    default:
      return { fg: V.ink, bg: "transparent", bd: V.ink };
  }
}

/** Resolve a tone keyword to just its ink color (for text). */
function toneInk(tone?: PlanWireframeTone): string {
  return toneColors(tone).fg;
}

function fontWeight(weight?: "normal" | "medium" | "bold"): number {
  if (weight === "bold") return 700;
  if (weight === "medium") return 600;
  return 400;
}

/* -------------------------------------------------------------------------- */
/* Screen — root frame. Paper bg, hand font, the sketch wobble filter.        */
/* -------------------------------------------------------------------------- */

export function Screen({
  children,
  pad = 0,
  sketch,
  density,
  theme,
  skeleton = false,
  style = {},
}: {
  children?: ReactNode;
  pad?: number | string;
  sketch?: number;
  density?: "compact" | "regular" | "roomy";
  theme?: "light" | "dark";
  /** Neutral loading register: rough off, borders dropped, soft placeholder fills. */
  skeleton?: boolean;
  style?: CSSProperties;
}) {
  const cfg = useContext(KitConfigContext);
  const isSkeleton = skeleton || Boolean(cfg.skeleton);
  const wfStyle = cfg.style ?? "sketchy";
  const wfTheme = theme ?? cfg.theme ?? "light";
  void sketch;
  return (
    <div
      className="plan-wf"
      data-density={density ?? "regular"}
      data-theme={wfTheme}
      data-skeleton={isSkeleton ? "true" : undefined}
      data-style={wfStyle}
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        background: V.paper,
        color: V.ink,
        fontFamily: V.hand,
        fontSize: V.fs,
        lineHeight: 1.25,
        display: "flex",
        flexDirection: "column",
        padding: pad,
        boxSizing: "border-box",
        overflow: "hidden",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Hand — handwritten text run.                                               */
/* -------------------------------------------------------------------------- */

export function Hand({
  children,
  size,
  weight = 400,
  color = V.ink,
  script = false,
  style = {},
}: {
  children?: ReactNode;
  size?: number | string;
  weight?: number;
  color?: string;
  script?: boolean;
  style?: CSSProperties;
}) {
  return (
    <span
      style={{
        fontFamily: script ? V.script : V.hand,
        fontSize: size ?? V.fs,
        fontWeight: weight,
        color,
        minWidth: 0,
        overflowWrap: "break-word",
        ...style,
      }}
    >
      {children}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Bar — a grey placeholder line standing in for un-drawn body text.          */
/* -------------------------------------------------------------------------- */

export function Bar({
  w = 80,
  h,
  color = V.line,
  r = 4,
  style = {},
}: {
  w?: number | string;
  h?: number | string;
  color?: string;
  r?: number | string;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        width: w,
        height: h ?? "calc(var(--fs) * 0.72)",
        background: color,
        borderRadius: r,
        flex: "0 0 auto",
        ...style,
      }}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Lines — stack of placeholder bars (paragraph stand-in).                    */
/* -------------------------------------------------------------------------- */

export function Lines({
  n = 2,
  gap = 6,
  widths,
  color = V.line,
  style = {},
}: {
  n?: number;
  gap?: number;
  widths?: Array<number | string>;
  color?: string;
  style?: CSSProperties;
}) {
  const ws =
    widths ??
    Array.from({ length: n }, (_, i) => (i === n - 1 ? "55%" : "100%"));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap, ...style }}>
      {ws.map((w, i) => (
        <Bar key={i} w={typeof w === "number" ? `${w}%` : w} color={color} />
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Box — generic hand-drawn container.                                        */
/* -------------------------------------------------------------------------- */

export function Box({
  children,
  pad = V.pad,
  fill = V.card,
  dashed = false,
  style = {},
}: {
  children?: ReactNode;
  pad?: number | string;
  fill?: string;
  dashed?: boolean;
  style?: CSSProperties;
}) {
  return (
    <div
      data-rough="rect"
      style={{
        ["--rough-stroke" as string]: V.ink,
        border: `${V.stroke} ${dashed ? "dashed" : "solid"} ${V.ink}`,
        borderRadius: V.radius,
        background: fill,
        padding: pad,
        boxSizing: "border-box",
        minWidth: 0,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Check — task checkbox. done -> accent fill + tick.                         */
/* -------------------------------------------------------------------------- */

export function Check({
  done = false,
  shape = "square",
  size = 18,
}: {
  done?: boolean;
  shape?: "square" | "circle";
  size?: number;
}) {
  const r = shape === "circle" ? "50%" : "calc(var(--radius) * 0.5)";
  return (
    <div
      data-rough={shape === "circle" ? "ellipse" : "rect"}
      style={{
        ["--rough-stroke" as string]: done ? V.accent : V.ink,
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

/* -------------------------------------------------------------------------- */
/* Pill — outline tag tinted by tone.                                         */
/* -------------------------------------------------------------------------- */

export function Pill({
  children,
  tone = "default",
  style = {},
}: {
  children?: ReactNode;
  tone?: PlanWireframeTone;
  style?: CSSProperties;
}) {
  const c = toneColors(tone);
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
        fontSize: "calc(var(--fs) * 0.82)",
        fontFamily: V.hand,
        maxWidth: "100%",
        minWidth: 0,
        whiteSpace: "normal",
        overflowWrap: "anywhere",
        lineHeight: 1.3,
        ...style,
      }}
    >
      {children}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Prio — priority dot. 1 = high (warn), 2 = med (soft), 3 = low (outline).   */
/* -------------------------------------------------------------------------- */

export function Prio({ level = 2, label }: { level?: number; label?: string }) {
  const fill = level === 1 ? V.warn : level === 2 ? V.soft : "transparent";
  const bd = level === 3 ? V.soft : "transparent";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
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
      {label && (
        <Hand size="calc(var(--fs) * 0.82)" color={V.soft}>
          {label}
        </Hand>
      )}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Btn — sketchy button. solid -> accent fill.                                */
/* -------------------------------------------------------------------------- */

export function Btn({
  children,
  solid = false,
  full = false,
  size = "md",
  tone = "default",
  style = {},
}: {
  children?: ReactNode;
  solid?: boolean;
  full?: boolean;
  size?: "sm" | "md" | "lg";
  tone?: PlanWireframeTone;
  style?: CSSProperties;
}) {
  const pad =
    size === "sm" ? "4px 10px" : size === "lg" ? "10px 18px" : "7px 14px";
  const c = toneColors(tone === "default" ? "accent" : tone);
  return (
    <div
      data-rough="rect"
      style={{
        ["--rough-stroke" as string]: solid ? c.bd : V.ink,
        display: full ? "flex" : "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        border: `${V.stroke} solid ${solid ? c.bd : V.ink}`,
        background: solid ? c.bd : "transparent",
        color: solid ? "#fff" : V.ink,
        borderRadius: V.radius,
        padding: pad,
        fontFamily: V.hand,
        fontSize: V.fs,
        fontWeight: 700,
        width: full ? "100%" : "auto",
        maxWidth: "100%",
        minWidth: 0,
        boxSizing: "border-box",
        whiteSpace: "normal",
        overflowWrap: "anywhere",
        textAlign: "center",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Chip — small filter / segmented option.                                    */
/* -------------------------------------------------------------------------- */

export function Chip({
  children,
  active = false,
  style = {},
}: {
  children?: ReactNode;
  active?: boolean;
  style?: CSSProperties;
}) {
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
        fontSize: "calc(var(--fs) * 0.88)",
        fontFamily: V.hand,
        fontWeight: active ? 700 : 400,
        maxWidth: "100%",
        minWidth: 0,
        whiteSpace: "normal",
        overflowWrap: "anywhere",
        ...style,
      }}
    >
      {children}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Field — form field: label + outlined input holding value or placeholder.   */
/* -------------------------------------------------------------------------- */

export function Field({
  label,
  value,
  placeholder,
  h,
  area = false,
  right,
  style = {},
}: {
  label?: string;
  value?: string;
  placeholder?: number | string;
  h?: number | string;
  area?: boolean;
  right?: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5, ...style }}>
      {label && (
        <Hand size="calc(var(--fs) * 0.86)" color={V.soft} weight={700}>
          {label}
        </Hand>
      )}
      <div
        data-rough="rect"
        style={{
          ["--rough-stroke" as string]: V.ink,
          border: `${V.stroke} solid ${V.ink}`,
          borderRadius: V.radius,
          background: V.card,
          padding: "calc(var(--pad) * 0.8)",
          minHeight: h ?? (area ? 64 : "auto"),
          display: "flex",
          alignItems: area ? "flex-start" : "center",
          justifyContent: "space-between",
          minWidth: 0,
          gap: 8,
        }}
      >
        {value ? (
          <Hand style={{ minWidth: 0, overflowWrap: "anywhere" }}>{value}</Hand>
        ) : area ? (
          <Lines n={2} widths={["85%", "60%"]} />
        ) : (
          <Bar w={placeholder ?? 110} />
        )}
        {right}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* StatusBar — phone status row.                                              */
/* -------------------------------------------------------------------------- */

export function StatusBar() {
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
      <Hand size="calc(var(--fs) * 0.82)" weight={700}>
        9:41
      </Hand>
      <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
        <Bar w={16} h={8} color={V.soft} r={2} />
        <Bar w={12} h={8} color={V.soft} r={2} />
        <Bar w={20} h={9} color={V.soft} r={2} />
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Fab — floating action button (bottom-right). Absolute by design.           */
/* -------------------------------------------------------------------------- */

export function Fab({ icon = "+" }: { icon?: string }) {
  return (
    <div
      data-rough="ellipse"
      style={{
        ["--rough-stroke" as string]: V.accent,
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
        fontFamily: V.hand,
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

/* -------------------------------------------------------------------------- */
/* BrowserBar — desktop window top chrome with address pill.                  */
/* -------------------------------------------------------------------------- */

export function BrowserBar({
  title = "todo",
  children,
}: {
  title?: string;
  children?: ReactNode;
}) {
  return (
    <div
      data-rough="line:bottom"
      style={{
        ["--rough-stroke" as string]: V.ink,
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
            data-rough="ellipse"
            style={{
              ["--rough-stroke" as string]: V.ink,
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
        <Bar w={12} h={10} color={V.soft} r={3} />
        <Hand size="calc(var(--fs) * 0.82)" color={V.soft}>
          {title}.app
        </Hand>
      </div>
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* SectionLabel — group header for a list section, optional right slot.       */
/* -------------------------------------------------------------------------- */

export function SectionLabel({
  children,
  right,
  tone = "muted",
}: {
  children?: ReactNode;
  right?: ReactNode;
  tone?: PlanWireframeTone;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        minWidth: 0,
        gap: 8,
      }}
    >
      <Hand
        size="calc(var(--fs) * 0.9)"
        weight={700}
        color={toneInk(tone)}
        style={{
          letterSpacing: 0.3,
          minWidth: 0,
          overflowWrap: "anywhere",
        }}
      >
        {children}
      </Hand>
      {right}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Avatar — little round placeholder.                                         */
/* -------------------------------------------------------------------------- */

export function Avatar({ size = 26 }: { size?: number }) {
  return (
    <div
      data-rough="ellipse"
      style={{
        ["--rough-stroke" as string]: V.ink,
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

/* -------------------------------------------------------------------------- */
/* IconSquare — generic small icon placeholder (a box with an inner square).  */
/* -------------------------------------------------------------------------- */

export function IconSquare({
  size = 18,
  active = false,
}: {
  size?: number;
  active?: boolean;
}) {
  return (
    <div
      data-rough="rect"
      style={{
        ["--rough-stroke" as string]: active ? V.accent : V.soft,
        width: size,
        height: size,
        flex: "0 0 auto",
        borderRadius: "calc(var(--radius) * 0.5)",
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

/* -------------------------------------------------------------------------- */
/* NavItem — sidebar nav row (icon/dot + label + optional count).            */
/* -------------------------------------------------------------------------- */

export function NavItem({
  label,
  count,
  active = false,
  dot = false,
  tone = "accent",
}: {
  label?: string;
  count?: number;
  active?: boolean;
  dot?: boolean;
  tone?: PlanWireframeTone;
}) {
  const dotColor = toneInk(tone);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 9,
        padding: "5px 8px",
        borderRadius: V.radius,
        background: active ? V.accentSoft : "transparent",
        minWidth: 0,
      }}
    >
      {dot ? (
        <span
          style={{
            width: 10,
            height: 10,
            borderRadius: "50%",
            border: `${V.stroke} solid ${dotColor}`,
            background: dotColor,
            flex: "0 0 auto",
          }}
        />
      ) : (
        <IconSquare size={15} active={active} />
      )}
      <Hand
        color={active ? V.accent : V.ink}
        weight={active ? 700 : 400}
        style={{ flex: 1, minWidth: 0 }}
      >
        {label}
      </Hand>
      {count != null && (
        <Hand size="calc(var(--fs) * 0.82)" color={V.soft}>
          {count}
        </Hand>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Sidebar — left rail container (flex column, right border).                 */
/* -------------------------------------------------------------------------- */

export function Sidebar({
  children,
  width = 196,
  style = {},
}: {
  children?: ReactNode;
  width?: number;
  style?: CSSProperties;
}) {
  return (
    <div
      data-rough="line:right"
      style={{
        ["--rough-stroke" as string]: V.ink,
        width,
        flex: "0 0 auto",
        borderRight: `${V.stroke} solid ${V.ink}`,
        background: V.card,
        padding: V.pad,
        display: "flex",
        flexDirection: "column",
        gap: V.gap,
        minHeight: 0,
        minWidth: 0,
        alignSelf: "stretch",
        overflow: "hidden",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Main — primary content pane (flex column, fills remaining width).          */
/* -------------------------------------------------------------------------- */

export function Main({
  children,
  style = {},
}: {
  children?: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        padding: "18px 24px",
        display: "flex",
        flexDirection: "column",
        gap: V.gap,
        overflow: "hidden",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Row / Col — flex direction containers.                                     */
/* -------------------------------------------------------------------------- */

export function Row({
  children,
  full = false,
  style = {},
}: {
  children?: ReactNode;
  full?: boolean;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "stretch",
        gap: V.gap,
        minWidth: 0,
        minHeight: 0,
        maxWidth: "100%",
        flex: full ? 1 : undefined,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function Col({
  children,
  full = false,
  style = {},
}: {
  children?: ReactNode;
  full?: boolean;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: V.gap,
        minWidth: 0,
        minHeight: 0,
        flex: full ? 1 : undefined,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* TaskRow — checkbox + title (+ note) + trailing due/prio meta.              */
/* -------------------------------------------------------------------------- */

export function TaskRow({
  title,
  note,
  due,
  dueTone = "default",
  prio,
  done = false,
}: {
  title?: string;
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
        padding: "calc(var(--pad) * 0.55) 0",
        minWidth: 0,
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
        <Hand
          color={done ? V.soft : V.ink}
          style={done ? { textDecoration: "line-through" } : undefined}
        >
          {title}
        </Hand>
        {note && (
          <Hand size="calc(var(--fs) * 0.85)" color={V.soft}>
            {note}
          </Hand>
        )}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          flexWrap: "wrap",
          justifyContent: "flex-end",
          gap: 8,
          flex: "0 0 auto",
        }}
      >
        {due && <Pill tone={dueTone}>{due}</Pill>}
        {prio ? <Prio level={prio} /> : null}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Card — generic content card (board / list item).                          */
/* -------------------------------------------------------------------------- */

export function Card({
  children,
  style = {},
}: {
  children?: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <Box
      pad="calc(var(--pad) * 0.9)"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        background: V.card,
        minWidth: 0,
        maxWidth: "100%",
        ...style,
      }}
    >
      {children}
    </Box>
  );
}

/* -------------------------------------------------------------------------- */
/* Column — kanban column: header (dot + title + count) over a stack.         */
/* -------------------------------------------------------------------------- */

export function Column({
  title,
  count,
  tone = "muted",
  width = 232,
  children,
}: {
  title?: string;
  count?: number;
  tone?: PlanWireframeTone;
  width?: number;
  children?: ReactNode;
}) {
  return (
    <div
      style={{
        width,
        flex: "0 0 auto",
        display: "flex",
        flexDirection: "column",
        gap: V.gap,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span
          style={{
            width: 9,
            height: 9,
            borderRadius: "50%",
            background: toneInk(tone),
            flex: "0 0 auto",
          }}
        />
        <Hand weight={700} style={{ whiteSpace: "nowrap" }}>
          {title}
        </Hand>
        {count != null && (
          <Hand size="calc(var(--fs) * 0.82)" color={V.soft}>
            {count}
          </Hand>
        )}
        <div style={{ flex: 1 }} />
        <Hand color={V.soft} weight={700}>
          +
        </Hand>
      </div>
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Toolbar — horizontal action/control strip with a bottom border.           */
/* -------------------------------------------------------------------------- */

export function Toolbar({
  children,
  style = {},
}: {
  children?: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div
      data-rough="line:bottom"
      style={{
        ["--rough-stroke" as string]: V.ink,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: V.gap,
        padding: "12px 22px",
        borderBottom: `${V.stroke} solid ${V.ink}`,
        background: V.card,
        flex: "0 0 auto",
        minWidth: 0,
        flexWrap: "wrap",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Tabs — pill tab strip (renders from items).                               */
/* -------------------------------------------------------------------------- */

export function Tabs({
  items = [],
}: {
  items?: Array<{ label: string; active?: boolean }>;
}) {
  return (
    <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
      {items.map((item, i) => (
        <Chip key={i} active={item.active}>
          {item.label}
        </Chip>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* KV — key/value rows (definition list).                                    */
/* -------------------------------------------------------------------------- */

export function KV({ rows = [] }: { rows?: Array<{ k: string; v: string }> }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {rows.map((row, i) => (
        <div
          key={i}
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <Hand size="calc(var(--fs) * 0.88)" color={V.soft}>
            {row.k}
          </Hand>
          <Hand
            style={{ textAlign: "right", minWidth: 0, wordBreak: "break-word" }}
          >
            {row.v}
          </Hand>
        </div>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* SearchBar — rounded search input stand-in.                                */
/* -------------------------------------------------------------------------- */

export function SearchBar({
  placeholder = "Search",
}: {
  placeholder?: string;
}) {
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
      <Bar w={11} h={11} color={V.soft} r={3} />
      <Hand size="calc(var(--fs) * 0.85)" color={V.soft}>
        {placeholder}
      </Hand>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Divider — thin horizontal rule using the line token.                      */
/* -------------------------------------------------------------------------- */

export function Divider({ style = {} }: { style?: CSSProperties }) {
  return (
    <div
      style={{
        height: V.stroke,
        background: V.line,
        flex: "0 0 auto",
        margin: "3px 0",
        ...style,
      }}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Title — large heading (script-friendly).                                  */
/* -------------------------------------------------------------------------- */

export function Title({
  text,
  script = false,
  size = "calc(var(--fs) * 2)",
  color = V.ink,
}: {
  text?: string;
  script?: boolean;
  size?: number | string;
  color?: string;
}) {
  return (
    <Hand script={script} size={size} weight={700} color={color}>
      {text}
    </Hand>
  );
}

/* -------------------------------------------------------------------------- */
/* Text — a plain text run with tone/weight (real content).                  */
/* -------------------------------------------------------------------------- */

export function Text({
  value,
  color,
  weight,
  script = false,
}: {
  value?: string;
  color?: PlanWireframeTone;
  weight?: "normal" | "medium" | "bold";
  script?: boolean;
}) {
  return (
    <Hand color={toneInk(color)} weight={fontWeight(weight)} script={script}>
      {value}
    </Hand>
  );
}

export { V as WFV, toneColors, toneInk, fontWeight };
