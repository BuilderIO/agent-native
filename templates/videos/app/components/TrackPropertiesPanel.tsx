import { useState } from "react";
import {
  IconClock,
  IconPlus,
  IconX,
  IconCode,
  IconChevronDown,
  IconCopy,
  IconCheck,
  IconBraces,
  IconBolt,
} from "@tabler/icons-react";
import type { AnimationTrack, AnimatedProp, EasingKey } from "@/types";
import { COMMON_PROP_TEMPLATES } from "@/types";
import { cn } from "@/lib/utils";
import { EASING_OPTIONS as EASING_OPTIONS_LIB } from "@/remotion/easingFunctions";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// ─── Constants ────────────────────────────────────────────────────────────────

const EASING_OPTIONS = EASING_OPTIONS_LIB;

const EASING_COLORS: Record<EasingKey, string> = {
  linear: "#94a3b8",
  spring: "#fbbf24",
  // Power eases - blue tones
  "power1.in": "#60a5fa",
  "power1.out": "#3b82f6",
  "power1.inOut": "#2563eb",
  "power2.in": "#60a5fa",
  "power2.out": "#3b82f6",
  "power2.inOut": "#2563eb",
  "power3.in": "#60a5fa",
  "power3.out": "#3b82f6",
  "power3.inOut": "#2563eb",
  "power4.in": "#60a5fa",
  "power4.out": "#3b82f6",
  "power4.inOut": "#2563eb",
  // Back - purple tones
  "back.in": "#a78bfa",
  "back.out": "#8b5cf6",
  "back.inOut": "#7c3aed",
  // Bounce - green tones
  "bounce.in": "#34d399",
  "bounce.out": "#10b981",
  "bounce.inOut": "#059669",
  // Circ - cyan tones
  "circ.in": "#22d3ee",
  "circ.out": "#06b6d4",
  "circ.inOut": "#0891b2",
  // Elastic - pink tones
  "elastic.in": "#f472b6",
  "elastic.out": "#ec4899",
  "elastic.inOut": "#db2777",
  // Expo - orange tones
  "expo.in": "#fb923c",
  "expo.out": "#f97316",
  "expo.inOut": "#ea580c",
  // Sine - teal tones
  "sine.in": "#5eead4",
  "sine.out": "#2dd4bf",
  "sine.inOut": "#14b8a6",
};

/** Label displayed in the badge for a known property */
const PROP_LABEL: Record<string, string> = {
  translateY: "Y",
  translateX: "X",
  opacity: "op",
  scale: "sc",
  rotate: "rot",
  width: "w",
  blur: "blur",
  radius: "r",
};

// Expression-controlled accent — blue tint
const EXPR_COLOR = "#60a5fa";

// ─── Types ────────────────────────────────────────────────────────────────────

type TrackPropertiesPanelProps = {
  track: AnimationTrack;
  fps: number;
  durationInFrames: number;
  onUpdateTrack: (id: string, patch: Partial<AnimationTrack>) => void;
};

// ─── Read-only code block ─────────────────────────────────────────────────────

function CodeBlock({ snippet }: { snippet: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(snippet).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="rounded-md overflow-hidden border border-zinc-700/30 opacity-70">
      <div className="flex items-center justify-between px-2.5 py-1 bg-zinc-900/60 border-b border-zinc-700/30">
        <div className="flex items-center gap-1.5">
          <IconBraces size={9} className="text-zinc-500/70" />
          <span className="text-[9px] font-mono text-zinc-500/70 uppercase tracking-wider">
            read-only
          </span>
        </div>
        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-1 text-[9px] font-mono text-zinc-500/70 hover:text-zinc-300 transition-colors"
        >
          {copied ? (
            <IconCheck size={9} className="text-green-400" />
          ) : (
            <IconCopy size={9} />
          )}
          {copied ? "copied" : "copy"}
        </button>
      </div>
      <pre className="bg-zinc-950/50 text-[10px] font-mono text-zinc-400 leading-relaxed p-2.5 overflow-x-auto whitespace-pre">
        {snippet}
      </pre>
    </div>
  );
}

// ─── Expression-driven prop row ───────────────────────────────────────────────

function ExpressionPropRow({
  prop,
  onRemove,
  onUpdate,
}: {
  prop: AnimatedProp;
  onRemove: () => void;
  onUpdate?: (updated: AnimatedProp) => void;
}) {
  const isProgrammatic = prop.programmatic ?? false;
  // Start collapsed - code is read-only and for curious users only
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className="rounded-lg border overflow-hidden"
      style={{
        borderColor: `${EXPR_COLOR}30`,
        backgroundColor: `${EXPR_COLOR}05`,
      }}
    >
      {/* Header row */}
      <div className="flex items-center gap-1.5 px-2 py-1.5">
        {/* fx badge */}
        <span
          className="text-[8px] font-mono font-bold px-1.5 py-0.5 rounded flex-shrink-0 uppercase tracking-wider"
          style={{ backgroundColor: `${EXPR_COLOR}20`, color: EXPR_COLOR }}
        >
          fx
        </span>

        <span className="text-[10px] font-mono text-foreground/70 flex-1 truncate">
          {prop.property}
          {prop.unit && !isProgrammatic ? (
            <span className="text-muted-foreground/35 ml-0.5">
              ({prop.unit})
            </span>
          ) : null}
        </span>

        {/* From → to inline (for hybrid props that have editable range) */}
        {!isProgrammatic && (
          <span className="flex items-center gap-1 flex-shrink-0">
            <span
              className="text-xs font-mono px-1.5 py-0.5 rounded"
              style={{
                backgroundColor: `${EXPR_COLOR}15`,
                color: `${EXPR_COLOR}cc`,
              }}
            >
              {prop.from}
            </span>
            <span className="text-[9px] text-muted-foreground/30 font-mono">
              →
            </span>
            <span
              className="text-xs font-mono px-1.5 py-0.5 rounded"
              style={{
                backgroundColor: `${EXPR_COLOR}15`,
                color: `${EXPR_COLOR}cc`,
              }}
            >
              {prop.to}
              {prop.unit ? (
                <span className="ml-0.5 text-[8px] opacity-60">
                  {prop.unit}
                </span>
              ) : null}
            </span>
          </span>
        )}

        {/* Expand toggle */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => setExpanded((e) => !e)}
              className="flex items-center gap-0.5 flex-shrink-0 px-1 py-0.5 rounded hover:bg-zinc-800/30 transition-colors text-[9px] font-mono"
              style={{ color: `${EXPR_COLOR}70` }}
            >
              <span className="uppercase tracking-wider">
                {expanded ? "hide" : "code"}
              </span>
              <IconChevronDown
                size={10}
                className={cn(expanded && "rotate-180")}
              />
            </button>
          </TooltipTrigger>
          <TooltipContent>
            {expanded ? "Hide code" : "View expression code"}
          </TooltipContent>
        </Tooltip>

        <button
          onClick={onRemove}
          aria-label={`Remove ${prop.property}`}
          className="flex-shrink-0 text-muted-foreground/30 hover:text-destructive/60 transition-colors"
        >
          <IconX size={11} />
        </button>
      </div>

      {/* Adjustable parameters - always visible */}
      {prop.parameters && prop.parameters.length > 0 && (
        <div
          className="px-2.5 pb-2.5 pt-2 space-y-2 border-t"
          style={{ borderColor: `${EXPR_COLOR}20` }}
        >
          <span
            className="text-[10px] uppercase tracking-wider font-semibold"
            style={{ color: `${EXPR_COLOR}80` }}
          >
            Parameters
          </span>
          <div className="space-y-2">
            {prop.parameters.map((param) => {
              const currentValue =
                prop.parameterValues?.[param.name] ?? param.default;
              return (
                <div key={param.name} className="space-y-0.5">
                  <label className="text-[9px] text-muted-foreground/60 font-mono">
                    {param.label}
                  </label>
                  <input
                    type="number"
                    value={currentValue}
                    min={param.min}
                    max={param.max}
                    step={param.step ?? 0.01}
                    onChange={(e) => {
                      const newValue =
                        parseFloat(e.target.value) || param.default;
                      onUpdate?.({
                        ...prop,
                        parameterValues: {
                          ...prop.parameterValues,
                          [param.name]: newValue,
                        },
                      });
                    }}
                    className="w-full bg-background border border-border/60 rounded px-1.5 py-1 text-[10px] font-mono text-foreground/80 focus:outline-none focus:ring-1 focus:ring-primary/40"
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Expanded panel - description and code */}
      {expanded && (
        <div
          className="px-2.5 pb-2.5 pt-0 space-y-2 border-t"
          style={{ borderColor: `${EXPR_COLOR}20` }}
        >
          {/* Description */}
          {prop.description && (
            <div className="pt-2 space-y-1">
              <div className="flex items-center gap-1">
                <IconBolt
                  size={9}
                  style={{ color: EXPR_COLOR, opacity: 0.7 }}
                />
                <span
                  className="text-[10px] uppercase tracking-wider font-semibold"
                  style={{ color: `${EXPR_COLOR}80` }}
                >
                  How it works
                </span>
              </div>
              <p className="text-[11px] leading-relaxed text-muted-foreground/70">
                {prop.description}
              </p>
            </div>
          )}

          {/* Editable from/to for hybrid props */}
          {!isProgrammatic && (
            <div className="space-y-1">
              <span
                className="text-[10px] uppercase tracking-wider font-semibold"
                style={{ color: `${EXPR_COLOR}80` }}
              >
                Values
              </span>
              <div className="flex items-center gap-1.5">
                <div className="flex-1 space-y-0.5">
                  <span className="text-[9px] text-muted-foreground/40 font-mono">
                    from
                  </span>
                  <input
                    type="number"
                    value={prop.from}
                    readOnly
                    className="w-full bg-background border border-border/40 rounded px-1.5 py-1 text-[10px] font-mono text-foreground/50 focus:outline-none cursor-not-allowed"
                  />
                </div>
                <span className="text-[9px] text-muted-foreground/30 font-mono mt-4">
                  →
                </span>
                <div className="flex-1 space-y-0.5">
                  <span className="text-[9px] text-muted-foreground/40 font-mono">
                    to
                  </span>
                  <input
                    type="number"
                    value={prop.to}
                    readOnly
                    className="w-full bg-background border border-border/40 rounded px-1.5 py-1 text-[10px] font-mono text-foreground/50 focus:outline-none cursor-not-allowed"
                  />
                </div>
                {prop.unit && (
                  <span className="text-[9px] text-muted-foreground/30 font-mono mt-4">
                    {prop.unit}
                  </span>
                )}
              </div>
              <p className="text-[9px] text-muted-foreground/35 italic">
                Edit these values in the track's Animated Properties section
                above.
              </p>
            </div>
          )}

          {/* Source code */}
          {prop.codeSnippet && (
            <div className="space-y-1">
              <div className="flex items-center gap-1.5">
                <span
                  className="text-[10px] uppercase tracking-wider font-semibold"
                  style={{ color: `${EXPR_COLOR}80` }}
                >
                  Expression
                </span>
                <span className="text-[8px] text-muted-foreground/40 font-mono italic">
                  read-only
                </span>
              </div>
              <CodeBlock snippet={prop.codeSnippet} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Standard editable prop row ───────────────────────────────────────────────

function AnimatedPropRow({
  prop,
  accentColor,
  onUpdate,
  onRemove,
}: {
  prop: AnimatedProp;
  accentColor: string;
  onUpdate: (updated: AnimatedProp) => void;
  onRemove: () => void;
}) {
  const isCustom = prop.isCustom ?? false;
  const hasCode = !!prop.codeSnippet || !!prop.description;
  const [codeOpen, setCodeOpen] = useState(false);
  const badge = PROP_LABEL[prop.property] ?? prop.property.slice(0, 4);

  const inputCls =
    "bg-background border border-border/60 rounded px-1.5 py-1 text-[10px] font-mono text-foreground/80 focus:outline-none focus:ring-1 focus:ring-primary/40 w-full";

  return (
    <div
      className="rounded-lg border p-2 space-y-2"
      style={{
        borderColor: `${accentColor}25`,
        backgroundColor: `${accentColor}06`,
      }}
    >
      {/* Row 1: badge / property name + actions */}
      <div className="flex items-center gap-1.5">
        {isCustom ? (
          <input
            value={prop.property === "custom" ? "" : prop.property}
            placeholder="css-property…"
            onChange={(e) =>
              onUpdate({ ...prop, property: e.target.value || "custom" })
            }
            className={`${inputCls} flex-1`}
          />
        ) : (
          <>
            <span
              className="text-[9px] font-mono font-semibold px-1.5 py-0.5 rounded flex-shrink-0"
              style={{
                backgroundColor: `${accentColor}20`,
                color: accentColor,
              }}
            >
              {badge}
            </span>
            <span className="text-[10px] text-muted-foreground/60 flex-1 truncate">
              {prop.property}
              {prop.unit ? (
                <span className="text-muted-foreground/35 ml-0.5">
                  ({prop.unit})
                </span>
              ) : null}
            </span>
          </>
        )}

        {/* Code indicator — only if there's a description or snippet */}
        {hasCode && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => setCodeOpen((o) => !o)}
                className="flex-shrink-0 flex items-center gap-0.5 px-1 py-0.5 rounded transition-colors"
                style={{
                  color: codeOpen ? accentColor : `${accentColor}50`,
                  backgroundColor: codeOpen
                    ? `${accentColor}15`
                    : "transparent",
                }}
              >
                <IconCode size={10} />
              </button>
            </TooltipTrigger>
            <TooltipContent>
              {codeOpen ? "Hide details" : "How this works"}
            </TooltipContent>
          </Tooltip>
        )}

        <button
          onClick={onRemove}
          aria-label={`Remove ${prop.property}`}
          className="flex-shrink-0 text-muted-foreground/40 hover:text-destructive/70 transition-colors"
        >
          <IconX size={11} />
        </button>
      </div>

      {/* Row 2: from → to */}
      {isCustom ? (
        <div className="space-y-1.5">
          <div className="flex items-start gap-1">
            <span className="text-[9px] text-muted-foreground/50 w-7 pt-1 flex-shrink-0 font-mono">
              from
            </span>
            <textarea
              rows={2}
              value={prop.from}
              placeholder="e.g. translateX(-100%) rotate(10deg)"
              onChange={(e) => onUpdate({ ...prop, from: e.target.value })}
              className="flex-1 bg-background border border-border/60 rounded px-1.5 py-1 text-[10px] font-mono text-foreground/80 resize-none focus:outline-none focus:ring-1 focus:ring-primary/40"
            />
          </div>
          <div className="flex items-start gap-1">
            <span className="text-[9px] text-muted-foreground/50 w-7 pt-1 flex-shrink-0 font-mono">
              to
            </span>
            <textarea
              rows={2}
              value={prop.to}
              placeholder="e.g. translateX(0) rotate(0deg)"
              onChange={(e) => onUpdate({ ...prop, to: e.target.value })}
              className="flex-1 bg-background border border-border/60 rounded px-1.5 py-1 text-[10px] font-mono text-foreground/80 resize-none focus:outline-none focus:ring-1 focus:ring-primary/40"
            />
          </div>
        </div>
      ) : (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1">
            <div className="relative flex-1">
              <input
                type="number"
                value={prop.from}
                onChange={(e) => onUpdate({ ...prop, from: e.target.value })}
                className={inputCls}
              />
            </div>
            <span className="text-[9px] text-muted-foreground/40 flex-shrink-0 font-mono">
              →
            </span>
            <div className="relative flex-1">
              <input
                type="number"
                value={prop.to}
                onChange={(e) => onUpdate({ ...prop, to: e.target.value })}
                className={inputCls}
              />
            </div>
            {prop.unit && (
              <span className="text-[9px] text-muted-foreground/40 flex-shrink-0 font-mono">
                {prop.unit}
              </span>
            )}
          </div>

          {/* Motion curve for keyframed properties */}
          {prop.keyframes && prop.keyframes.length > 0 && (
            <div className="space-y-0.5">
              <label className="text-[8px] text-muted-foreground/50 uppercase tracking-wider">
                Motion Curve
              </label>
              <Select
                value={prop.easing ?? "linear"}
                onValueChange={(val) =>
                  onUpdate({ ...prop, easing: val as EasingKey })
                }
              >
                <Tooltip>
                  <TooltipTrigger asChild>
                    <SelectTrigger
                      className="w-full h-auto text-[10px] bg-background border border-border/60 rounded px-1.5 py-1 text-foreground/80 focus:outline-none focus:ring-1 focus:ring-primary/40"
                      aria-label="Applies to all keyframe segments"
                    >
                      <SelectValue />
                    </SelectTrigger>
                  </TooltipTrigger>
                  <TooltipContent>
                    Applies to all keyframe segments
                  </TooltipContent>
                </Tooltip>
                <SelectContent>
                  {EASING_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      )}

      {/* Expandable description + code */}
      {hasCode && codeOpen && (
        <div
          className="space-y-2 pt-1 border-t"
          style={{ borderColor: `${accentColor}20` }}
        >
          {prop.description && (
            <div className="space-y-1">
              <div className="flex items-center gap-1">
                <IconBolt
                  size={9}
                  style={{ color: accentColor, opacity: 0.6 }}
                />
                <span className="text-[9px] uppercase tracking-wider font-semibold text-muted-foreground/50">
                  How it works
                </span>
              </div>
              <p className="text-[11px] leading-relaxed text-muted-foreground/65">
                {prop.description}
              </p>
            </div>
          )}
          {prop.codeSnippet && <CodeBlock snippet={prop.codeSnippet} />}
        </div>
      )}
    </div>
  );
}

// ─── Add-property dropdown ────────────────────────────────────────────────────

function PropPicker({
  templates,
  accentColor,
  onSelect,
}: {
  templates: typeof COMMON_PROP_TEMPLATES;
  accentColor: string;
  onSelect: (property: string) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="w-full flex items-center justify-between gap-1.5 text-[10px] border border-dashed rounded-lg px-2.5 py-1.5 transition-colors focus:outline-none"
          style={{
            borderColor: `${accentColor}35`,
            color: `${accentColor}99`,
            backgroundColor: `${accentColor}06`,
          }}
          onMouseEnter={(e) =>
            (e.currentTarget.style.backgroundColor = `${accentColor}12`)
          }
          onMouseLeave={(e) =>
            (e.currentTarget.style.backgroundColor = `${accentColor}06`)
          }
        >
          <span className="flex items-center gap-1">
            <IconPlus size={9} />
            Add property…
          </span>
          <IconChevronDown size={9} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="start"
        className="w-[var(--radix-dropdown-menu-trigger-width)]"
      >
        {templates.map((t) => (
          <DropdownMenuItem
            key={t.property}
            className="text-[11px] text-foreground/80"
            onSelect={() => onSelect(t.property)}
          >
            {t.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export function TrackPropertiesPanel({
  track,
  fps,
  durationInFrames,
  onUpdateTrack,
}: TrackPropertiesPanelProps) {
  const duration = track.endFrame - track.startFrame;
  const startSec = (track.startFrame / fps).toFixed(2);
  const endSec = (track.endFrame / fps).toFixed(2);
  const durationSec = (duration / fps).toFixed(2);
  const accentColor = EASING_COLORS[track.easing];

  const animatedProps: AnimatedProp[] = track.animatedProps ?? [];

  // ── Helpers ──────────────────────────────────────────────────────────────

  const setProps = (next: AnimatedProp[]) =>
    onUpdateTrack(track.id, { animatedProps: next });

  const handleUpdateProp = (index: number, updated: AnimatedProp) =>
    setProps(animatedProps.map((p, i) => (i === index ? updated : p)));

  const handleRemoveProp = (index: number) =>
    setProps(animatedProps.filter((_, i) => i !== index));

  const handleAddProp = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    if (!value) return;
    e.target.value = "";

    const tpl = COMMON_PROP_TEMPLATES.find((t) => t.property === value);
    if (!tpl) return;

    const newProp: AnimatedProp = {
      property: tpl.isCustom ? "custom" : tpl.property,
      from: tpl.defaultFrom,
      to: tpl.defaultTo,
      unit: tpl.unit,
      isCustom: tpl.isCustom,
    };
    setProps([...animatedProps, newProp]);
  };

  // Properties already added (excluding custom, which can be added multiple times)
  const usedProps = new Set(
    animatedProps.filter((p) => !p.isCustom).map((p) => p.property),
  );
  const availableTemplates = COMMON_PROP_TEMPLATES.filter(
    (t) => t.isCustom || !usedProps.has(t.property),
  );

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-3 p-4 border-t">
      {/* ── Label ──────────────────────────────────────────────────────── */}
      <div className="space-y-1">
        <label className="text-[10px] text-muted-foreground uppercase tracking-wider">
          Label
        </label>
        <input
          type="text"
          value={track.label}
          onChange={(e) => onUpdateTrack(track.id, { label: e.target.value })}
          className="w-full text-xs bg-secondary border border-border rounded-lg px-3 py-1.5 text-foreground/80 focus:outline-none focus:ring-1 focus:ring-primary/40"
        />
      </div>

      {/* ── Easing ─────────────────────────────────────────────────────── */}
      <div className="space-y-1">
        <label className="text-[10px] text-muted-foreground uppercase tracking-wider">
          Timing Function
        </label>
        <div className="relative">
          <Select
            value={track.easing}
            onValueChange={(val) =>
              onUpdateTrack(track.id, { easing: val as EasingKey })
            }
          >
            <SelectTrigger className="w-full h-auto text-xs bg-secondary border border-border rounded-lg px-3 py-1.5 text-foreground/80 focus:outline-none focus:ring-1 focus:ring-primary/40">
              <div className="flex items-center gap-2">
                <SelectValue />
                <div
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: accentColor }}
                />
              </div>
            </SelectTrigger>
            <SelectContent>
              {EASING_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* ── Frame bounds ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <label className="text-[10px] text-muted-foreground uppercase tracking-wider">
            Start <span className="normal-case opacity-40">(f)</span>
          </label>
          <input
            type="number"
            min={0}
            max={track.endFrame - 1}
            value={track.startFrame}
            onChange={(e) =>
              onUpdateTrack(track.id, {
                startFrame: Math.max(
                  0,
                  Math.min(track.endFrame - 1, Number(e.target.value)),
                ),
              })
            }
            className="w-full text-xs bg-secondary border border-border rounded-lg px-2 py-1.5 text-foreground/80 font-mono focus:outline-none focus:ring-1 focus:ring-primary/40"
          />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] text-muted-foreground uppercase tracking-wider">
            End <span className="normal-case opacity-40">(f)</span>
          </label>
          <input
            type="number"
            min={track.startFrame + 1}
            max={durationInFrames}
            value={track.endFrame}
            onChange={(e) =>
              onUpdateTrack(track.id, {
                endFrame: Math.max(
                  track.startFrame + 1,
                  Math.min(durationInFrames, Number(e.target.value)),
                ),
              })
            }
            className="w-full text-xs bg-secondary border border-border rounded-lg px-2 py-1.5 text-foreground/80 font-mono focus:outline-none focus:ring-1 focus:ring-primary/40"
          />
        </div>
      </div>

      {/* ── Timing summary ──────────────────────────────────────────────── */}
      <div
        className="flex items-center gap-1.5 pb-1 border-b"
        style={{ borderColor: `${accentColor}20` }}
      >
        <IconClock size={10} style={{ color: accentColor, opacity: 0.7 }} />
        <span className="text-[10px] font-mono text-muted-foreground/55">
          {startSec}s → {endSec}s
        </span>
        <span className="text-muted-foreground/30 text-[10px]">·</span>
        <span className="text-[10px] font-mono text-muted-foreground/55">
          {durationSec}s ({duration}f)
        </span>
      </div>

      {/* ── Animated Properties ─────────────────────────────────────────── */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <IconCode size={11} style={{ color: accentColor, opacity: 0.8 }} />
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
              Animated Properties
            </span>
          </div>
          {animatedProps.length > 0 && (
            <span
              className="text-[10px] font-mono px-1 py-0.5 rounded"
              style={{
                backgroundColor: `${accentColor}15`,
                color: accentColor,
              }}
            >
              {animatedProps.length}
            </span>
          )}
        </div>

        {/* Prop rows */}
        {animatedProps.length === 0 ? (
          <div
            className="text-[10px] text-muted-foreground/35 text-center py-3 rounded-lg border border-dashed"
            style={{ borderColor: `${accentColor}20` }}
          >
            No properties — add one below
          </div>
        ) : (
          <div className="space-y-1.5">
            {animatedProps.map((prop, i) =>
              prop.programmatic ? (
                /* Fully code-driven: fx badge, description card, read-only source */
                <ExpressionPropRow
                  key={i}
                  prop={prop}
                  onUpdate={(updated) => handleUpdateProp(i, updated)}
                  onRemove={() => handleRemoveProp(i)}
                />
              ) : (
                /* Editable (may have codeSnippet/description for "how it works") */
                <AnimatedPropRow
                  key={i}
                  prop={prop}
                  accentColor={accentColor}
                  onUpdate={(updated) => handleUpdateProp(i, updated)}
                  onRemove={() => handleRemoveProp(i)}
                />
              ),
            )}
          </div>
        )}

        {/* Add property picker — custom dropdown (avoids Radix React-instance conflict) */}
        {availableTemplates.length > 0 && (
          <PropPicker
            templates={availableTemplates}
            accentColor={accentColor}
            onSelect={(property) =>
              handleAddProp({ target: { value: property } } as any)
            }
          />
        )}
      </div>
    </div>
  );
}
