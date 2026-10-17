/**
 * Static, decorative recreation of an agent chat exchange that turns an
 * attached brief into a deck: a prompt with a file chip, then the generated
 * slides appearing as a thumbnail strip — used as the art for the "Create sales
 * and pitch decks" use-case row on the Slides landing page.
 *
 * All CSS lives here, scoped under `.slides-pitch-mock`, following the same
 * convention as ClipsInvestigateBugMock.tsx. The real Slides stylesheet is
 * deliberately NOT imported: it declares `:root`/`html`/`body` palette rules
 * that would reskin the whole docs site.
 *
 * The card is flat on purpose: the surrounding rows sit directly on the section
 * background, and a drop shadow made the card float out of that plane.
 *
 * The response and the deck strip fade and unblur up into place each time they
 * scroll into view (an IntersectionObserver toggles the class that plays the
 * transition, and un-toggles it on exit so the reveal replays on re-entry), so
 * the card reads as the brief resolving into slides rather than arriving fully
 * formed. The prompt above is unanimated — it's the given, not the reveal.
 *
 * i18n-raw-literal-disable-file -- this is artwork, not UI copy. The wrapper is
 * a `role="img"` with a localized `aria-label` and the entire frame inside it is
 * `aria-hidden`, so no assistive tech ever reads these strings; they are the
 * pixels of a product screenshot (a fake chat transcript and a fake deck).
 */
import { IconChevronRight, IconFileText } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";

import {
  ChartSlide,
  ImageSlide,
  SLIDE_ARTWORK_CSS,
  TitleSlide,
  VarScaledSlide,
} from "./SlidesDeckArtwork";

const DECK_STRIP = [
  { id: "title", number: 1, render: TitleSlide },
  { id: "chart", number: 4, render: ChartSlide },
  { id: "image", number: 5, render: ImageSlide },
] as const;

const SLIDES_PITCH_MOCK_CSS = [
  ".slides-pitch-mock { position: relative; width: 100%; }",
  ".slides-pitch-mock, .slides-pitch-mock * { box-sizing: border-box; }",
  ".slides-pitch-mock-frame { display: flex; flex-direction: column; gap: 22px; overflow: hidden; padding: 32px; border-radius: 12px; background: var(--pitch-window-bg); border: 1px solid var(--pitch-window-border); font-family: 'Inter Variable', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }",

  ".slides-pitch-mock { --pitch-window-bg: #1c1c1c; --pitch-window-border: #2c2c2c; --pitch-prompt-bg: #2c2c2c; --pitch-prompt-border: #3d3d3d; --pitch-fg: #e6e6e6; --pitch-fg-muted: #999999; --pitch-fg-subtle: #808080; --pitch-chip-bg: #383838; }",

  ".slides-pitch-mock-prompt { display: flex; flex-direction: column; gap: 12px; padding: 16px 18px; border-radius: 8px; background: var(--pitch-prompt-bg); border: 1px solid var(--pitch-prompt-border); color: var(--pitch-fg); font-size: 16px; line-height: 1.5; }",
  ".slides-pitch-mock-attachment { display: inline-flex; align-self: flex-start; align-items: center; gap: 7px; padding: 6px 11px; border-radius: 999px; background: var(--pitch-chip-bg); color: var(--pitch-fg-muted); font-size: 13px; }",

  ".slides-pitch-mock-response { display: flex; flex-direction: column; gap: 16px; opacity: 0; filter: blur(8px); transform: translateY(16px); transition: opacity 0.7s cubic-bezier(0.5, 1, 0.89, 1), filter 0.7s cubic-bezier(0.5, 1, 0.89, 1), transform 0.7s cubic-bezier(0.5, 1, 0.89, 1); }",
  ".slides-pitch-mock-response.slides-pitch-reveal-in { opacity: 1; filter: blur(0); transform: translateY(0); }",
  "@media (scripting: none) { .slides-pitch-mock-response { opacity: 1; filter: none; transform: none; } }",
  "@media (prefers-reduced-motion: reduce) { .slides-pitch-mock-response { opacity: 1; filter: none; transform: none; transition: none; } }",

  ".slides-pitch-mock-step { display: flex; align-items: center; gap: 2px; color: var(--pitch-fg-subtle); font-size: 14px; }",
  ".slides-pitch-mock-heading { color: var(--pitch-fg); font-size: 15.5px; font-weight: 500; }",

  ".slides-pitch-mock-strip { --sd-scale: 0.17; display: flex; gap: 12px; }",
  ".slides-pitch-mock-slide { display: flex; flex-direction: column; gap: 6px; min-width: 0; }",
  ".slides-pitch-mock-slide .sd-slide-box { overflow: hidden; border: 1px solid var(--pitch-window-border); border-radius: 5px; }",
  ".slides-pitch-mock-slide-number { color: var(--pitch-fg-subtle); font-size: 11px; font-variant-numeric: tabular-nums; }",

  "html.light .slides-pitch-mock { --pitch-window-bg: #fdfdfb; --pitch-window-border: #e3e0d8; --pitch-prompt-bg: #f1f0ea; --pitch-prompt-border: #e3e0d8; --pitch-fg: #22201c; --pitch-fg-muted: #56534d; --pitch-fg-subtle: #827e76; --pitch-chip-bg: #e5e3db; }",

  SLIDE_ARTWORK_CSS,

  "@media (max-width: 1320px) { .slides-pitch-mock-strip { --sd-scale: 0.14; } }",
  "@media (max-width: 560px) { .slides-pitch-mock-frame { padding: 22px; } .slides-pitch-mock-strip { --sd-scale: 0.115; gap: 8px; } }",
  "@media (max-width: 440px) { .slides-pitch-mock-strip { --sd-scale: 0.095; } }",
].join("\n");

export function SlidesPitchDeckMock({
  className = "",
  label,
}: {
  className?: string;
  label?: string;
}) {
  const responseRef = useRef<HTMLDivElement>(null);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    const node = responseRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      ([entry]) => setRevealed(entry?.isIntersecting ?? false),
      { threshold: 0.4 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      className={`slides-pitch-mock ${className}`}
      role="img"
      aria-label={label}
    >
      <style>{SLIDES_PITCH_MOCK_CSS}</style>
      <div className="slides-pitch-mock-frame" aria-hidden="true">
        <div className="slides-pitch-mock-prompt">
          <span className="slides-pitch-mock-attachment">
            <IconFileText size={14} />
            Northwind-seed-brief.pdf
          </span>
          Turn this into a 12-slide investor deck in our brand style.
        </div>
        <div
          ref={responseRef}
          className={`slides-pitch-mock-response ${revealed ? "slides-pitch-reveal-in" : ""}`}
        >
          <div className="slides-pitch-mock-step">
            Read the brief and applied Northwind Brand{" "}
            <IconChevronRight size={14} />
          </div>
          <div className="slides-pitch-mock-heading">
            Built 12 slides: story, traction, plan, and the ask.
          </div>
          <div className="slides-pitch-mock-strip">
            {DECK_STRIP.map((slide) => {
              const Slide = slide.render;
              return (
                <div key={slide.id} className="slides-pitch-mock-slide">
                  <VarScaledSlide>
                    <Slide />
                  </VarScaledSlide>
                  <span className="slides-pitch-mock-slide-number">
                    {slide.number}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
