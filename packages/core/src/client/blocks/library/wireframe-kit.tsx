import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import rough from "roughjs";

import type {
  WireframeElName,
  WireframeNode,
  WireframeTone,
} from "./wireframe.config.js";

/**
 * Shared wireframe "kit" — hand-drawn low-fi primitives, the el → component node
 * registry, the rough.js sketch overlay, and the viewer-level sketchy/clean
 * style preference. Ported verbatim (geometry-wise) from the plan template's
 * `app/components/plan/wireframe/kit/*` so any app can render wireframe blocks.
 *
 * DECOUPLING: the only behavioral change from the plan copy is theme detection —
 * core blocks read `document.documentElement.classList.contains("dark")` (the
 * MermaidBlock precedent) instead of importing `next-themes`. Everything else
 * (the `.plan-wf` / `[data-rough]` class contract the rough overlay measures,
 * the `--wf-*` / `--ink` / `--paper` token names every primitive reads) is
 * preserved exactly, so the kit looks identical in plan and renders correctly in
 * any app once the matching tokens exist in `core/styles/blocks.css`.
 */

/* ========================================================================== */
/* Viewer-level wireframe style preference (localStorage)                     */
/* ========================================================================== */

export type WireframeStyle = "sketchy" | "clean";

const STYLE_STORAGE_KEY = "plan-wireframe-style";
const styleListeners = new Set<() => void>();

function readStoredStyle(): WireframeStyle {
  if (typeof localStorage === "undefined") return "sketchy";
  try {
    return localStorage.getItem(STYLE_STORAGE_KEY) === "clean"
      ? "clean"
      : "sketchy";
  } catch {
    return "sketchy";
  }
}

let currentStyle: WireframeStyle = readStoredStyle();

export function setWireframeStyle(style: WireframeStyle): void {
  if (style === currentStyle) return;
  currentStyle = style;
  try {
    localStorage.setItem(STYLE_STORAGE_KEY, style);
  } catch {
    // ignore (private mode / disabled storage)
  }
  for (const listener of styleListeners) listener();
}

export function toggleWireframeStyle(): void {
  setWireframeStyle(currentStyle === "sketchy" ? "clean" : "sketchy");
}

function subscribeStyle(callback: () => void): () => void {
  styleListeners.add(callback);
  const onStorage = (event: StorageEvent) => {
    if (event.key === STYLE_STORAGE_KEY) {
      currentStyle = readStoredStyle();
      callback();
    }
  };
  if (typeof window !== "undefined") {
    window.addEventListener("storage", onStorage);
  }
  return () => {
    styleListeners.delete(callback);
    if (typeof window !== "undefined") {
      window.removeEventListener("storage", onStorage);
    }
  };
}

export function useWireframeStyle(): WireframeStyle {
  return useSyncExternalStore(
    subscribeStyle,
    () => currentStyle,
    () => "sketchy",
  );
}

/** Read the live dark-mode flag from the document root (next-themes-free). */
export function useIsDark(): boolean {
  const [isDark, setIsDark] = useState(false);
  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    const read = () => setIsDark(root.classList.contains("dark"));
    read();
    const observer = new MutationObserver(read);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return isDark;
}

/* ========================================================================== */
/* Primitives (ported from kit/primitives.tsx)                                */
/* ========================================================================== */

/**
 * Frame-level config threaded to every Screen so skeleton / theme / sketch-vs-
 * clean reach the kit no matter which path renders the root Screen.
 */
export const KitConfigContext = createContext<{
  skeleton?: boolean;
  sketch?: number;
  theme?: "light" | "dark";
  style?: "sketchy" | "clean";
}>({});

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

type ToneColors = { fg: string; bg: string; bd: string };

function toneColors(tone: WireframeTone = "default"): ToneColors {
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

function toneInk(tone?: WireframeTone): string {
  return toneColors(tone).fg;
}

function fontWeight(weight?: "normal" | "medium" | "bold"): number {
  if (weight === "bold") return 700;
  if (weight === "medium") return 600;
  return 400;
}

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
        // `minHeight` (not a fixed `height: 100%`) so the screen fills an
        // auto-height artboard's floor yet grows with its content instead of
        // clipping. The frame shell (`ArtboardFrame`) owns the height policy; a
        // caller can still override via `style.height` for a fixed canvas.
        minHeight: "100%",
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

export function Pill({
  children,
  tone = "default",
  style = {},
}: {
  children?: ReactNode;
  tone?: WireframeTone;
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
  tone?: WireframeTone;
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

export function SectionLabel({
  children,
  right,
  tone = "muted",
}: {
  children?: ReactNode;
  right?: ReactNode;
  tone?: WireframeTone;
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
  tone?: WireframeTone;
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
  dueTone?: WireframeTone;
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

export function Column({
  title,
  count,
  tone = "muted",
  width = 232,
  children,
}: {
  title?: string;
  count?: number;
  tone?: WireframeTone;
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

export function Text({
  value,
  color,
  weight,
  script = false,
}: {
  value?: string;
  color?: WireframeTone;
  weight?: "normal" | "medium" | "bold";
  script?: boolean;
}) {
  return (
    <Hand color={toneInk(color)} weight={fontWeight(weight)} script={script}>
      {value}
    </Hand>
  );
}

/* ========================================================================== */
/* Node registry (ported from kit/registry.tsx)                               */
/* ========================================================================== */

type NodeRenderer = (node: WireframeNode, children: ReactNode) => ReactNode;

const REGISTRY: Record<WireframeElName, NodeRenderer> = {
  // --- Frame / structure -------------------------------------------------
  screen: (n) => {
    const kids = n.children ?? [];
    const lead = kids[0]?.el;
    if (lead === "browserBar") {
      return (
        <Screen pad={0}>
          {renderNode(kids[0], kids[0].id ?? "browserbar")}
          {renderScreenBodyNodes(kids.slice(1))}
        </Screen>
      );
    }
    if (lead === "statusBar") {
      return (
        <Screen pad={0}>
          {renderNode(kids[0], kids[0].id ?? "statusbar")}
          <div
            style={{
              flex: 1,
              minHeight: 0,
              display: "flex",
              flexDirection: "column",
              gap: "var(--gap)",
              padding: "calc(var(--pad) * 1.1)",
            }}
          >
            {renderScreenBodyNodes(kids.slice(1))}
          </div>
        </Screen>
      );
    }
    return (
      <Screen pad="calc(var(--pad) * 1.35)">
        {renderScreenBodyNodes(kids)}
      </Screen>
    );
  },
  browserBar: (n, children) => (
    <BrowserBar title={n.title ?? n.text}>{children}</BrowserBar>
  ),
  statusBar: () => <StatusBar />,
  toolbar: (_n, children) => <Toolbar>{children}</Toolbar>,
  row: (n, children) => <Row full={n.full}>{children}</Row>,
  col: (n, children) => <Col full={n.full}>{children}</Col>,
  sidebar: (_n, children) => <Sidebar>{children}</Sidebar>,
  main: (_n, children) => <Main>{children}</Main>,
  box: (n, children) => <Box dashed={n.dashed}>{children}</Box>,
  card: (_n, children) => <Card>{children}</Card>,
  column: (n, children) => (
    <Column title={n.title ?? n.text} count={n.count} tone={n.tone}>
      {children}
    </Column>
  ),
  divider: () => <Divider />,

  // --- Text --------------------------------------------------------------
  title: (n) => <Title text={n.text} script={n.script} />,
  text: (n) => (
    <Text
      value={n.value ?? n.text}
      color={n.color}
      weight={n.weight}
      script={n.script}
    />
  ),
  lines: (n) => <Lines n={n.n} widths={n.widths} />,
  section: (n) => (
    <SectionLabel tone={n.tone}>{n.label ?? n.text}</SectionLabel>
  ),

  // --- List / task -------------------------------------------------------
  navItem: (n) => (
    <NavItem
      label={n.label ?? n.text}
      count={n.count}
      active={n.active}
      dot={n.dot}
      tone={n.tone}
    />
  ),
  taskRow: (n) => (
    <TaskRow
      title={n.title ?? n.text}
      note={n.note}
      due={n.due}
      dueTone={n.dueTone}
      prio={n.prio}
      done={n.done}
    />
  ),

  // --- Controls ----------------------------------------------------------
  chips: (n) => <Tabs items={n.items ?? []} />,
  chip: (n) => <Chip active={n.active}>{n.label ?? n.text}</Chip>,
  pill: (n) => <Pill tone={n.tone}>{n.label ?? n.text}</Pill>,
  check: (n) => <Check done={n.done} shape={n.shape} />,
  field: (n) => (
    <Field
      label={n.label}
      value={n.value}
      placeholder={n.placeholder}
      area={n.area}
    />
  ),
  btn: (n) => (
    <Btn solid={n.solid} full={n.full} tone={n.tone}>
      {n.label ?? n.text}
    </Btn>
  ),
  fab: (n) => <Fab icon={n.icon} />,
  searchBar: (n) => <SearchBar placeholder={n.placeholder} />,

  // --- Atoms -------------------------------------------------------------
  avatar: () => <Avatar />,
  iconSquare: (n) => <IconSquare active={n.active} />,
  kv: (n) => <KV rows={n.rows ?? []} />,
};

function renderScreenBodyNode(
  node: WireframeNode,
  key?: string | number,
): ReactNode {
  const shouldFill =
    node.full !== false &&
    (node.el === "row" || node.el === "col" || node.el === "main");
  return renderNode(shouldFill ? { ...node, full: true } : node, key);
}

function renderScreenBodyNodes(nodes: WireframeNode[]): ReactNode {
  return nodes.map((node, i) =>
    renderScreenBodyNode(node, node.id ?? `screen-body-${i}`),
  );
}

/** Render a single kit-tree node (and its children, recursively). */
export function renderNode(
  node: WireframeNode,
  key?: string | number,
): ReactNode {
  const renderer = REGISTRY[node.el];
  const children = node.children?.length ? renderNodes(node.children) : null;
  if (!renderer) {
    return children ? <div key={key}>{children}</div> : null;
  }
  const rendered = renderer(node, children);
  return <KeyedNode key={key ?? node.id}>{rendered}</KeyedNode>;
}

/** Render an array of nodes. */
export function renderNodes(nodes: WireframeNode[]): ReactNode {
  return nodes.map((node, i) => renderNode(node, node.id ?? i));
}

/** Lightweight keyed wrapper that does not introduce extra DOM. */
function KeyedNode({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

/** Whether an `el` name has a registered renderer. */
export function hasRenderer(el: string): el is WireframeElName {
  return el in REGISTRY;
}

export { REGISTRY as NODE_REGISTRY, V as WFV, toneColors, toneInk, fontWeight };

/* ========================================================================== */
/* Rough overlay (ported from kit/rough.tsx)                                  */
/* ========================================================================== */

const gen = rough.generator();

type RoughPath = { d: string; stroke: string; strokeWidth: number };

/** The default selector used for HTML mockups: controls plus explicit opt-ins. */
export const HTML_ROUGH_SELECTOR =
  "[data-rough],button,input,textarea,select,hr";

/** Stable per-element seed so a frame doesn't re-wobble on every measure. */
function seedFrom(...parts: Array<string | number>): number {
  const value = parts.join(":");
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 2147483646) + 1;
}

/** Map the 0–100 sketch slider to a rough.js roughness (calm + legible). */
export function sketchRoughness(sketch: number): number {
  const s = Math.max(0, Math.min(100, Number.isFinite(sketch) ? sketch : 0));
  return Number((0.32 + (s / 100) * 1.15).toFixed(2));
}

function sketchBowing(sketch: number): number {
  const s = Math.max(0, Math.min(100, Number.isFinite(sketch) ? sketch : 0));
  return Number((0.4 + (s / 100) * 0.5).toFixed(2));
}

function readVar(el: Element, name: string): string {
  return getComputedStyle(el).getPropertyValue(name).trim();
}

/** Normalize a CSS color (hex or rgb[a]) to "r,g,b" for equality comparison. */
function toRgbKey(color: string): string | null {
  const c = color.trim();
  const hex = c.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const h = hex[1];
    const full =
      h.length === 3
        ? h
            .split("")
            .map((d) => d + d)
            .join("")
        : h;
    const n = parseInt(full, 16);
    return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
  }
  const rgb = c.match(/rgba?\(([^)]+)\)/i);
  if (rgb) {
    const [r, g, b] = rgb[1].split(",").map((v) => parseInt(v.trim(), 10));
    return `${r},${g},${b}`;
  }
  return null;
}

/** True when two CSS colors resolve to the same RGB (hex vs rgb tolerant). */
function sameColor(a: string, b: string): boolean {
  const ka = toRgbKey(a);
  const kb = toRgbKey(b);
  return ka !== null && ka === kb;
}

/** A rounded-rect SVG path (so the frame stroke follows the artboard radius). */
function roundedRectPath(
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): string {
  const rad = Math.max(0, Math.min(r, w / 2, h / 2));
  return [
    `M${x + rad},${y}`,
    `H${x + w - rad}`,
    `A${rad},${rad} 0 0 1 ${x + w},${y + rad}`,
    `V${y + h - rad}`,
    `A${rad},${rad} 0 0 1 ${x + w - rad},${y + h}`,
    `H${x + rad}`,
    `A${rad},${rad} 0 0 1 ${x},${y + h - rad}`,
    `V${y + rad}`,
    `A${rad},${rad} 0 0 1 ${x + rad},${y}`,
    "Z",
  ].join(" ");
}

function elementStroke(node: Element, fallback: string): string {
  const explicit = readVar(node, "--rough-stroke");
  if (explicit) return explicit;
  const cs = getComputedStyle(node);
  for (const side of [
    "borderTopColor",
    "borderLeftColor",
    "borderBottomColor",
    "borderRightColor",
  ] as const) {
    const width = parseFloat(
      cs.getPropertyValue(side.replace("Color", "Width")),
    );
    const color = cs[side];
    if (width > 0 && color && color !== "rgba(0, 0, 0, 0)") return color;
  }
  return fallback;
}

function build(
  scope: HTMLElement,
  opts: {
    roughness: number;
    bowing: number;
    frameRadius: number;
    drawFrame: boolean;
    selector: string;
  },
): { paths: RoughPath[]; w: number; h: number } {
  const base = scope.getBoundingClientRect();
  const layoutW = scope.offsetWidth;
  const layoutH = scope.offsetHeight;
  if (!layoutW || !layoutH) return { paths: [], w: 0, h: 0 };
  const zoom = base.width / layoutW || 1;

  const themed =
    (scope.matches(".plan-wf, .plan-html-frame, .plan-diagram-frame")
      ? scope
      : scope.querySelector(
          ".plan-wf, .plan-html-frame, .plan-diagram-frame",
        )) ?? scope;
  const ink =
    readVar(themed, "--ink") || readVar(themed, "--wf-ink") || "#34322e";
  const sketch = readVar(themed, "--wf-sketch") || ink;
  const line = readVar(themed, "--wf-line") || readVar(themed, "--line") || "";

  const paths: RoughPath[] = [];
  let index = 0;
  const push = (drawable: unknown, stroke: string, sw: number) => {
    for (const p of gen.toPaths(
      drawable as Parameters<typeof gen.toPaths>[0],
    )) {
      paths.push({
        d: p.d,
        stroke: p.stroke && p.stroke !== "none" ? p.stroke : stroke,
        strokeWidth: p.strokeWidth || sw,
      });
    }
  };
  const makeOpts = (stroke: string, sw: number, seed: number) => ({
    seed,
    roughness: opts.roughness,
    bowing: opts.bowing,
    stroke,
    strokeWidth: sw,
    preserveVertices: true,
  });

  if (opts.drawFrame) {
    const sw = 2;
    push(
      gen.path(
        roundedRectPath(2, 2, layoutW - 4, layoutH - 4, opts.frameRadius),
        {
          ...makeOpts(sketch, sw, seedFrom("frame", layoutW, layoutH)),
          roughness: opts.roughness + 0.35,
          bowing: opts.bowing + 0.18,
        },
      ),
      sketch,
      sw,
    );
  }

  scope.querySelectorAll<HTMLElement>(opts.selector).forEach((node) => {
    if (node.getAttribute("data-rough") === "none") return;
    if (readVar(node, "--rough-skip") === "1") return;
    const r = node.getBoundingClientRect();
    const x = (r.left - base.left) / zoom;
    const y = (r.top - base.top) / zoom;
    const w = r.width / zoom;
    const h = r.height / zoom;
    if (w < 2 || h < 2) return;
    const kind = node.getAttribute("data-rough") || "rect";
    const rawStroke = elementStroke(node, sketch);
    const stroke =
      sameColor(rawStroke, ink) || (line !== "" && sameColor(rawStroke, line))
        ? sketch
        : rawStroke;
    const sw = Number(readVar(node, "--rough-w")) || 1.4;
    const seed = seedFrom(
      kind,
      Math.round(x),
      Math.round(y),
      Math.round(w),
      Math.round(h),
      index++,
    );
    const o = makeOpts(stroke, sw, seed);
    let drawable: unknown;
    if (kind === "ellipse") {
      drawable = gen.ellipse(x + w / 2, y + h / 2, w, h, o);
    } else if (kind === "line:right") {
      drawable = gen.line(x + w, y, x + w, y + h, o);
    } else if (kind === "line:bottom") {
      drawable = gen.line(x, y + h, x + w, y + h, o);
    } else if (kind === "line:top" || node.tagName === "HR") {
      drawable = gen.line(x, y + h / 2, x + w, y + h / 2, o);
    } else {
      const cr = parseFloat(getComputedStyle(node).borderTopLeftRadius) || 0;
      const radius = Math.min(cr / zoom, w / 2, h / 2);
      drawable =
        radius > 1
          ? gen.path(roundedRectPath(x + 1, y + 1, w - 2, h - 2, radius), o)
          : gen.rectangle(x + 1, y + 1, w - 2, h - 2, o);
    }
    push(drawable, stroke, sw);
  });

  return { paths, w: layoutW, h: layoutH };
}

/**
 * Renders the rough overlay for a frame. `scopeRef` points at the frame root.
 * When `enabled` is false (skeleton / clean register) it renders nothing and the
 * crisp CSS borders stay visible.
 */
export function RoughOverlay({
  scopeRef,
  sketch = 52,
  enabled = true,
  drawFrame = true,
  frameRadius = 14,
  selector = "[data-rough]",
}: {
  scopeRef: RefObject<HTMLElement | null>;
  sketch?: number;
  enabled?: boolean;
  drawFrame?: boolean;
  frameRadius?: number;
  selector?: string;
}) {
  const [state, setState] = useState<{
    paths: RoughPath[];
    w: number;
    h: number;
  }>({ paths: [], w: 0, h: 0 });
  const rafRef = useRef(0);

  useEffect(() => {
    const el = scopeRef.current;
    if (!el || !enabled) {
      el?.removeAttribute("data-rough-ready");
      el?.querySelector(
        ".plan-wf, .plan-html-frame, .plan-diagram-frame",
      )?.removeAttribute("data-rough-ready");
      setState({ paths: [], w: 0, h: 0 });
      return;
    }
    const roughness = sketchRoughness(sketch);
    const bowing = sketchBowing(sketch);
    const measure = () => {
      clearTimeout(rafRef.current);
      rafRef.current = window.setTimeout(() => {
        const next = build(el, {
          roughness,
          bowing,
          frameRadius,
          drawFrame,
          selector,
        });
        if (next.w && next.h) {
          el.setAttribute("data-rough-ready", "true");
          (
            el.querySelector(
              ".plan-wf, .plan-html-frame, .plan-diagram-frame",
            ) ?? el
          ).setAttribute("data-rough-ready", "true");
          setState(next);
        }
      }, 0);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    el.querySelectorAll(selector).forEach((node) => ro.observe(node));
    const mo = new MutationObserver((mutations) => {
      if (mutations.every(isRoughOverlayMutation)) return;
      measure();
    });
    mo.observe(el, {
      attributes: true,
      childList: true,
      characterData: true,
      subtree: true,
    });
    el.addEventListener("plan-prototype-runtime:rendered", measure);
    let cancelled = false;
    if (typeof document !== "undefined" && "fonts" in document) {
      void document.fonts.ready.then(() => {
        if (!cancelled) measure();
      });
    }
    return () => {
      cancelled = true;
      ro.disconnect();
      mo.disconnect();
      el.removeEventListener("plan-prototype-runtime:rendered", measure);
      clearTimeout(rafRef.current);
      el.removeAttribute("data-rough-ready");
      el.querySelector(
        ".plan-wf, .plan-html-frame, .plan-diagram-frame",
      )?.removeAttribute("data-rough-ready");
    };
  }, [scopeRef, sketch, enabled, drawFrame, frameRadius, selector]);

  if (!enabled || !state.paths.length) return null;
  return (
    <svg
      aria-hidden
      className="plan-rough-overlay"
      width="100%"
      height="100%"
      viewBox={`0 0 ${state.w} ${state.h}`}
      preserveAspectRatio="none"
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        overflow: "hidden",
        zIndex: 3,
      }}
    >
      {state.paths.map((p, i) => (
        <path
          key={i}
          d={p.d}
          fill="none"
          stroke={p.stroke}
          strokeWidth={p.strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </svg>
  );
}

function isRoughOverlayMutation(mutation: MutationRecord) {
  if (nodeIsRoughOverlay(mutation.target)) return true;

  const changedNodes = [
    ...Array.from(mutation.addedNodes),
    ...Array.from(mutation.removedNodes),
  ];
  return changedNodes.length > 0 && changedNodes.every(nodeIsRoughOverlay);
}

function nodeIsRoughOverlay(node: Node) {
  const element = node instanceof Element ? node : node.parentElement;
  return Boolean(
    element?.classList.contains("plan-rough-overlay") ||
    element?.closest(".plan-rough-overlay"),
  );
}
