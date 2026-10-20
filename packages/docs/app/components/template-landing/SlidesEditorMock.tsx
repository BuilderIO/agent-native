/**
 * Static, decorative recreation of the Slides deck editor mid-edit — the slide
 * rail on the left, one slide on the canvas, and the agent panel open on the
 * right — used as landing-page hero art.
 *
 * All CSS lives here, scoped under `.slides-mock`. The real stylesheet
 * (templates/slides/app/global.css) is deliberately NOT imported: it declares
 * `:root`/`html`/`body` palette rules that would reskin the whole docs site.
 * The custom properties below mirror its tokens by hand instead.
 *
 * The agent panel is open because agent-plus-editor is the product, not a
 * feature of it: a deck editor alone is not what this page is selling.
 *
 * Two details are drawn the way the app actually behaves rather than the way a
 * deck mockup usually looks. The rail marks the current slide with a filled
 * `bg-accent` row, not an outline on the thumbnail. And there is no "Saved"
 * pill in the toolbar — the real one stays silent while saving and only speaks
 * up to report "Failed to save" or "Offline".
 *
 * The slides themselves live in SlidesDeckArtwork.tsx, authored at the
 * renderer's real 960x540 logical size and scaled, so the rail thumbnails and
 * the canvas are literally the same slides at two zooms.
 *
 * i18n-raw-literal-disable-file -- this is artwork, not UI copy. The wrapper is
 * a `role="img"` with a localized `aria-label` and the entire frame inside it is
 * `aria-hidden`, so no assistive tech ever reads these strings; they are the
 * pixels of a product screenshot (a fake deck, fake collaborators, fake chat
 * transcript). Translating them across 11 catalogs would add churn with nothing
 * to show for it, since the localized alt text is what a non-English reader
 * actually gets.
 */
import {
  IconArrowLeft,
  IconArrowUp,
  IconBold,
  IconBolt,
  IconChevronDown,
  IconDotsVertical,
  IconItalic,
  IconLayoutAlignCenter,
  IconLayoutAlignLeft,
  IconLayoutAlignRight,
  IconList,
  IconPalette,
  IconPaperclip,
  IconPhoto,
  IconPlayerPlay,
  IconPlus,
  IconShape,
  IconStack2,
  IconTypography,
  IconUnderline,
} from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";

import {
  ChartSlide,
  ImageSlide,
  PlanSlide,
  SectionSlide,
  SLIDE_ARTWORK_CSS,
  SLIDE_WIDTH,
  ScaledSlide,
  StatementSlide,
  StatsSlide,
  TitleSlide,
  UpdateSlide,
  VarScaledSlide,
} from "./SlidesDeckArtwork";

const RAIL_WIDTH = 208;
const AGENT_WIDTH = 340;
const TOOLBAR_HEIGHT = 48;
const CONTEXT_TOOLBAR_HEIGHT = 40;

const THUMB_WIDTH = RAIL_WIDTH - 16 - 12 - 22;
const THUMB_SCALE = THUMB_WIDTH / SLIDE_WIDTH;

const CANVAS_SCALE_STEPS = [{ maxWidth: 1280, scale: 0.48 }];
const CANVAS_SCALE_WIDE = 0.62;

const NARROW_WINDOW_WIDTH = 1220;

const NARROW_STEPS = [
  { maxWidth: 1150, scale: 0.85 },
  { maxWidth: 1000, scale: 0.72 },
  { maxWidth: 860, scale: 0.6 },
  { maxWidth: 700, scale: 0.48 },
  { maxWidth: 600, scale: 0.4 },
  { maxWidth: 500, scale: 0.32 },
  { maxWidth: 420, scale: 0.26 },
  { maxWidth: 360, scale: 0.22 },
];

const DECK_SLIDES = [
  { id: "title", render: TitleSlide },
  { id: "section", render: SectionSlide },
  { id: "stats", render: StatsSlide },
  { id: "chart", render: ChartSlide, selected: true },
  { id: "image", render: ImageSlide },
  { id: "plan", render: PlanSlide },
  { id: "update", render: UpdateSlide },
  { id: "statement", render: StatementSlide },
] as const;

const ALIGN_TOOLS = [
  IconLayoutAlignLeft,
  IconLayoutAlignCenter,
  IconLayoutAlignRight,
] as const;

const AGENT_SUGGESTIONS = ["Tighten the copy", "Add a closing slide"];

const THINKING_MS = 1000;
const TYPE_START_MS = 1080;
const CHAR_MS = 16;

const AGENT_TURNS = [
  {
    prompt: "Start a Q3 board deck from the revenue doc.",
    step: "Read",
    stepRef: "Q3-revenue.docx",
    reply: "Drafted 14 slides: story, traction, plan, and the ask.",
  },
  {
    prompt:
      "Use the real pipeline numbers from Salesforce instead of the pasted table.",
    step: "Connected Salesforce through",
    stepRef: "Dispatch",
    reply:
      "Pulled six quarters of closed-won and regional pipeline. The deck reads from the connection now, so the figures refresh when you open it.",
  },
  {
    prompt:
      "Put Northwind Brand on all 14 slides, make the chart labels consistent, and rewrite the speaker notes in our voice.",
    step: "Updated",
    stepRef: "14 slides",
    reply:
      "Brand type and colour applied throughout, axis labels standardised to $M, stat cards aligned to the grid, and every speaker note rewritten.",
  },
  {
    prompt: "Now chart net new ARR by quarter on slide 4.",
    reply:
      "Slide 4 charts net new ARR across the last six quarters, with Q3 called out at $4.8M.",
  },
] as const;

function charDelay(index: number) {
  return { animationDelay: TYPE_START_MS + index * CHAR_MS + "ms" };
}

function TypedReply({ text }: { text: string }) {
  const words = text.split(" ");
  let charIndex = 0;

  return (
    <span className="sm-agent-reply sm-agent-typed">
      {words.map((word, wordIndex) => (
        <span key={word + wordIndex}>
          <span className="sm-type-word">
            {Array.from(word).map((character, index) => (
              <span
                key={index}
                className="sm-type-char"
                style={charDelay(charIndex++)}
              >
                {character}
              </span>
            ))}
          </span>
          {wordIndex < words.length - 1 ? " " : null}
        </span>
      ))}
    </span>
  );
}

function Toolbar() {
  return (
    <div className="sm-toolbar">
      <span className="sm-icon-btn">
        <IconArrowLeft size={16} />
      </span>
      <span className="sm-toolbar-title">Northwind Q3 Review</span>
      <span className="sm-toolbar-spacer" />
      <span className="sm-presence">
        <span className="sm-avatar sm-avatar-1">PS</span>
        <span className="sm-avatar sm-avatar-2">TL</span>
        <span className="sm-avatar sm-avatar-3">ID</span>
      </span>
      <span className="sm-icon-btn">
        <IconDotsVertical size={16} />
      </span>
      <span className="sm-btn-secondary">Share</span>
      <span className="sm-btn-primary">
        <IconPlayerPlay size={14} />
        Present
      </span>
    </div>
  );
}

function SlideRail() {
  return (
    <div className="sm-rail">
      {DECK_SLIDES.map((slide, index) => {
        const Slide = slide.render;
        return (
          <div
            key={slide.id}
            className={
              "selected" in slide && slide.selected
                ? "sm-rail-row is-selected"
                : "sm-rail-row"
            }
          >
            <span className="sm-rail-number">{index + 1}</span>
            <div className="sm-rail-thumb">
              <ScaledSlide scale={THUMB_SCALE}>
                <Slide />
              </ScaledSlide>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ContextToolbar() {
  return (
    <div className="sm-context-toolbar">
      <span className="sm-tool-pill">
        <IconPlus size={14} />
        New slide
      </span>
      <span className="sm-context-divider" />
      <span className="sm-icon-btn">
        <IconShape size={15} />
        <IconChevronDown size={10} className="sm-icon-btn-caret" />
      </span>
      <span className="sm-icon-btn">
        <IconPhoto size={15} />
      </span>
      <span className="sm-icon-btn">
        <IconPalette size={15} />
      </span>
      <span className="sm-context-divider" />
      <span className="sm-tool-select">
        Inter
        <IconChevronDown size={10} />
      </span>
      <span className="sm-tool-select">
        32
        <IconChevronDown size={10} />
      </span>
      <span className="sm-context-divider" />
      <span className="sm-icon-btn is-active">
        <IconBold size={15} />
      </span>
      <span className="sm-icon-btn">
        <IconItalic size={15} />
      </span>
      <span className="sm-icon-btn">
        <IconUnderline size={15} />
      </span>
      <span className="sm-icon-btn">
        <IconTypography size={15} />
      </span>
      <span className="sm-context-divider" />
      {ALIGN_TOOLS.map((Tool, index) => (
        <span key={index} className="sm-icon-btn">
          <Tool size={15} />
        </span>
      ))}
      <span className="sm-icon-btn">
        <IconList size={15} />
      </span>
      <span className="sm-context-divider" />
      <span className="sm-icon-btn">
        <IconBolt size={15} />
      </span>
      <span className="sm-icon-btn">
        <IconStack2 size={15} />
      </span>
      <span className="sm-toolbar-spacer" />
    </div>
  );
}

function AgentPanel() {
  const streamRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const node = streamRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      ([entry]) => setPlaying(entry?.isIntersecting ?? false),
      { threshold: 0.35 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="sm-agent">
      <div className="sm-agent-transcript">
        {AGENT_TURNS.map((turn, index) => (
          <div key={turn.prompt} className="sm-agent-turn">
            <div className="sm-agent-prompt">{turn.prompt}</div>
            {"step" in turn ? (
              <div className="sm-agent-step">
                {turn.step} <span className="sm-agent-ref">{turn.stepRef}</span>
              </div>
            ) : null}
            {index === AGENT_TURNS.length - 1 ? (
              <div
                ref={streamRef}
                className={
                  playing ? "sm-agent-stream is-playing" : "sm-agent-stream"
                }
              >
                <span className="sm-agent-thinking">Thinking</span>
                <TypedReply text={turn.reply} />
              </div>
            ) : (
              <div className="sm-agent-reply">{turn.reply}</div>
            )}
          </div>
        ))}
        <div className="sm-agent-chips">
          {AGENT_SUGGESTIONS.map((suggestion) => (
            <span key={suggestion} className="sm-agent-chip">
              {suggestion}
            </span>
          ))}
        </div>
      </div>
      <div className="sm-agent-composer">
        <IconPaperclip size={16} />
        <span className="sm-agent-composer-label" />
        <span className="sm-agent-send">
          <IconArrowUp size={15} />
        </span>
      </div>
    </div>
  );
}

const THINKING_SHINE_CSS =
  "@supports ((background-clip: text) or (-webkit-background-clip: text)) { .slides-mock .sm-agent-thinking { color: transparent; background: linear-gradient(90deg, var(--sm-muted-foreground) 0%, var(--sm-muted-foreground) 36%, var(--sm-foreground) 50%, var(--sm-muted-foreground) 64%, var(--sm-muted-foreground) 100%); background-size: 14rem 100%; background-repeat: repeat; background-clip: text; -webkit-background-clip: text; -webkit-text-fill-color: transparent; } }";

const PLAYING_CSS = [
  ".slides-mock .sm-agent-stream.is-playing .sm-agent-thinking { animation: sm-thinking-life " +
    THINKING_MS +
    "ms linear forwards, sm-thinking-shine 2.6s linear infinite; }",
  ".slides-mock .sm-agent-stream.is-playing .sm-type-char { animation: sm-type-in 50ms linear forwards; }",
];

const SLIDES_MOCK_CSS = [
  ".slides-mock { position: relative; width: 100%; padding: 0 40px 28px; overflow: hidden; }",
  ".slides-mock, .slides-mock * { box-sizing: border-box; }",
  ".slides-mock-frame { position: relative; height: 100%; }",

  ".slides-mock { --sm-background: hsl(0 0% 13%); --sm-surface: hsl(0 0% 10%); --sm-card: hsl(0 0% 15%); --sm-border: hsl(0 0% 24%); --sm-foreground: hsl(0 0% 93%); --sm-muted-foreground: hsl(0 0% 55%); --sm-accent-row: hsl(0 0% 18%); --sm-primary: hsl(0 0% 90%); --sm-primary-foreground: hsl(0 0% 10%); --sm-avatar-fg: hsl(0 0% 85%); --sm-avatar-1: hsl(0 0% 40%); --sm-avatar-2: hsl(0 0% 32%); --sm-avatar-3: hsl(0 0% 25%); }",

  ".slides-mock .sm-window { position: absolute; inset: 0; display: flex; flex-direction: column; overflow: hidden; border-radius: 12px; border: 1px solid var(--sm-border); background: var(--sm-background); color: var(--sm-foreground); font-family: 'Inter Variable', 'Inter', system-ui, -apple-system, sans-serif; }",
  ".slides-mock .sm-window-topbar { display: flex; flex-shrink: 0; align-items: center; gap: 6px; padding: 10px 12px; border-bottom: 1px solid var(--sm-border); background: var(--sm-surface); }",
  ".slides-mock .sm-window-topbar span { width: 11px; height: 11px; border-radius: 999px; background: var(--sm-border); }",
  ".slides-mock .sm-window-body { display: flex; flex: 1; min-height: 0; }",

  `.slides-mock .sm-toolbar { display: flex; height: ${TOOLBAR_HEIGHT}px; flex-shrink: 0; align-items: center; gap: 4px; padding: 0 12px; background: var(--sm-background); }`,
  ".slides-mock .sm-toolbar-title { margin-left: 4px; overflow: hidden; font-size: 14px; font-weight: 500; text-overflow: ellipsis; white-space: nowrap; }",
  ".slides-mock .sm-toolbar-spacer { flex: 1; min-width: 8px; }",
  ".slides-mock .sm-icon-btn { position: relative; display: flex; height: 28px; min-width: 28px; flex-shrink: 0; align-items: center; justify-content: center; border-radius: 6px; color: var(--sm-muted-foreground); }",
  ".slides-mock .sm-icon-btn-caret { margin-left: 1px; }",
  ".slides-mock .sm-btn-primary { display: flex; height: 30px; flex-shrink: 0; align-items: center; gap: 5px; padding: 0 12px; border-radius: 6px; background: var(--sm-primary); color: var(--sm-primary-foreground); font-size: 13px; font-weight: 500; }",
  ".slides-mock .sm-btn-secondary { display: flex; height: 30px; flex-shrink: 0; align-items: center; padding: 0 12px; border: 1px solid var(--sm-border); border-radius: 6px; color: var(--sm-foreground); font-size: 13px; font-weight: 500; }",

  ".slides-mock .sm-presence { display: flex; flex-shrink: 0; align-items: center; padding-right: 4px; }",
  ".slides-mock .sm-avatar { display: flex; width: 26px; height: 26px; align-items: center; justify-content: center; border: 1px solid var(--sm-background); border-radius: 999px; color: var(--sm-avatar-fg); font-size: 10px; font-weight: 600; }",
  ".slides-mock .sm-avatar + .sm-avatar { margin-left: -8px; }",
  ".slides-mock .sm-avatar-1 { background: var(--sm-avatar-1); }",
  ".slides-mock .sm-avatar-2 { background: var(--sm-avatar-2); }",
  ".slides-mock .sm-avatar-3 { background: var(--sm-avatar-3); }",

  `.slides-mock .sm-rail { display: flex; width: ${RAIL_WIDTH}px; flex-shrink: 0; flex-direction: column; gap: 4px; overflow: hidden; padding: 8px; border-right: 1px solid var(--sm-border); background: var(--sm-background); }`,
  ".slides-mock .sm-rail-row { display: flex; flex-shrink: 0; align-items: center; gap: 6px; padding: 6px; border-radius: 8px; }",
  ".slides-mock .sm-rail-row.is-selected { background: var(--sm-accent-row); }",
  ".slides-mock .sm-rail-number { width: 16px; flex-shrink: 0; text-align: center; color: var(--sm-muted-foreground); font-size: 10px; font-weight: 500; line-height: 20px; }",
  ".slides-mock .sm-rail-thumb { overflow: hidden; border: 1px solid var(--sm-border); border-radius: 4px; }",

  ".slides-mock .sm-canvas { display: flex; flex: 1; min-width: 0; flex-direction: column; background: var(--sm-surface); }",
  `.slides-mock .sm-context-toolbar { display: flex; height: ${CONTEXT_TOOLBAR_HEIGHT}px; flex-shrink: 0; align-items: center; gap: 2px; overflow: hidden; padding: 0 10px; border-bottom: 1px solid var(--sm-border); background: var(--sm-background); }`,
  ".slides-mock .sm-tool-pill { display: flex; height: 28px; flex-shrink: 0; align-items: center; gap: 5px; padding: 0 10px 0 8px; border-radius: 6px; color: var(--sm-foreground); font-size: 13px; font-weight: 500; }",
  ".slides-mock .sm-tool-select { display: flex; height: 28px; flex-shrink: 0; align-items: center; gap: 4px; padding: 0 7px; border-radius: 6px; color: var(--sm-foreground); font-size: 12px; }",
  ".slides-mock .sm-icon-btn.is-active { background: var(--sm-accent-row); color: var(--sm-foreground); }",
  ".slides-mock .sm-context-divider { width: 1px; height: 18px; flex-shrink: 0; margin: 0 6px; background: var(--sm-border); }",
  `.slides-mock .sm-workspace { --sd-scale: ${CANVAS_SCALE_WIDE}; display: flex; flex: 1; min-height: 0; align-items: center; justify-content: center; overflow: hidden; padding: 24px; }`,
  ...CANVAS_SCALE_STEPS.map(
    ({ maxWidth, scale }) =>
      `@media (max-width: ${maxWidth}px) { .slides-mock .sm-workspace { --sd-scale: ${scale}; } }`,
  ),
  ".slides-mock .sm-workspace .sd-slide-box { border-radius: 2px; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.07); }",

  `.slides-mock .sm-agent { display: flex; width: ${AGENT_WIDTH}px; flex-shrink: 0; flex-direction: column; overflow: hidden; border-left: 1px solid var(--sm-border); background: var(--sm-background); }`,
  ".slides-mock .sm-agent-transcript { display: flex; flex: 1; min-height: 0; flex-direction: column; justify-content: flex-end; gap: 22px; overflow: hidden; padding: 16px; }",
  ".slides-mock .sm-agent-turn { display: flex; flex-shrink: 0; flex-direction: column; gap: 10px; }",
  ".slides-mock .sm-agent-prompt { align-self: flex-end; max-width: 280px; padding: 10px 12px; border-radius: 10px; background: var(--sm-card); font-size: 13px; line-height: 1.5; }",
  ".slides-mock .sm-agent-step { display: flex; align-items: center; gap: 5px; color: var(--sm-muted-foreground); font-size: 12px; }",
  ".slides-mock .sm-agent-ref { color: var(--sm-foreground); }",
  ".slides-mock .sm-agent-reply { font-size: 13px; line-height: 1.55; color: var(--sm-foreground); }",
  ".slides-mock .sm-agent-stream { position: relative; }",
  ".slides-mock .sm-agent-thinking { position: absolute; left: 0; top: 0; opacity: 0; color: var(--sm-muted-foreground); font-size: 13px; font-weight: 500; line-height: 1.55; }",
  ".slides-mock .sm-agent-typed { display: block; }",
  ".slides-mock .sm-type-word { white-space: nowrap; }",
  ".slides-mock .sm-type-char { opacity: 0; }",

  THINKING_SHINE_CSS,

  "@keyframes sm-type-in { to { opacity: 1; } }",
  "@keyframes sm-thinking-life { 0%, 88% { opacity: 1; } 100% { opacity: 0; } }",
  "@keyframes sm-thinking-shine { 0% { background-position: 0 0; } 100% { background-position: 14rem 0; } }",

  ...PLAYING_CSS,

  "@media (scripting: none) { .slides-mock .sm-type-char { opacity: 1; } }",
  "@media (prefers-reduced-motion: reduce) { .slides-mock .sm-type-char, .slides-mock .sm-agent-stream.is-playing .sm-type-char { opacity: 1; animation: none; } .slides-mock .sm-agent-thinking { display: none; } }",

  ".slides-mock .sm-agent-chips { display: flex; flex-wrap: wrap; gap: 6px; }",
  ".slides-mock .sm-agent-chip { display: flex; height: 26px; align-items: center; padding: 0 10px; border: 1px solid var(--sm-border); border-radius: 999px; color: var(--sm-muted-foreground); font-size: 12px; }",
  ".slides-mock .sm-agent-composer { display: flex; flex-shrink: 0; align-items: center; gap: 10px; margin: 0 12px 12px; padding: 10px 12px; border: 1px solid var(--sm-border); border-radius: 10px; background: var(--sm-card); color: var(--sm-muted-foreground); }",
  ".slides-mock .sm-agent-composer-label { flex: 1 1 auto; }",
  ".slides-mock .sm-agent-send { display: flex; width: 24px; height: 24px; flex-shrink: 0; align-items: center; justify-content: center; border-radius: 999px; background: var(--sm-primary); color: var(--sm-primary-foreground); }",

  SLIDE_ARTWORK_CSS,

  "html.light .slides-mock { --sm-background: hsl(0 0% 100%); --sm-surface: hsl(0 0% 96%); --sm-card: hsl(0 0% 97%); --sm-border: hsl(0 0% 90%); --sm-foreground: hsl(0 0% 10%); --sm-muted-foreground: hsl(0 0% 46%); --sm-accent-row: hsl(0 0% 96%); --sm-primary: hsl(0 0% 15%); --sm-primary-foreground: hsl(0 0% 98%); --sm-avatar-fg: hsl(0 0% 30%); --sm-avatar-1: hsl(0 0% 72%); --sm-avatar-2: hsl(0 0% 79%); --sm-avatar-3: hsl(0 0% 86%); }",
  "html.light .slides-mock .sm-workspace .sd-slide-box { box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.22); }",

  `@media (max-width: ${NARROW_STEPS[0].maxWidth}px) { .slides-mock { padding: 0 16px 18px; } .slides-mock .sm-workspace { --sd-scale: ${CANVAS_SCALE_WIDE}; } .slides-mock .sm-window { width: ${NARROW_WINDOW_WIDTH}px; inset: 0 auto auto 0; transform-origin: top left; } }`,
  ...NARROW_STEPS.map(
    ({ maxWidth, scale }) =>
      `@media (max-width: ${maxWidth}px) { .slides-mock .sm-window { height: calc(100% / ${scale}); transform: scale(${scale}); } }`,
  ),
].join("\n");

export function SlidesEditorMock({
  className = "",
  label,
}: {
  className?: string;
  label?: string;
}) {
  return (
    <div className={`slides-mock ${className}`} role="img" aria-label={label}>
      <style>{SLIDES_MOCK_CSS}</style>
      <div className="slides-mock-frame" aria-hidden="true">
        <div className="sm-window">
          <div className="sm-window-topbar">
            <span />
            <span />
            <span />
          </div>
          <Toolbar />
          <ContextToolbar />
          <div className="sm-window-body">
            <SlideRail />
            <div className="sm-canvas">
              <div className="sm-workspace">
                <VarScaledSlide>
                  <ChartSlide selected />
                </VarScaledSlide>
              </div>
            </div>
            <AgentPanel />
          </div>
        </div>
      </div>
    </div>
  );
}
