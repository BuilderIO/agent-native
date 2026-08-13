import { useLocale, useT } from "@agent-native/core/client/i18n";
import { useRef, useState } from "react";
import { Link } from "react-router";

import { sitePathForLocale } from "../components/docs-locale";
import { TemplateDocsLink } from "../components/template-docs";
import { templates, trackEvent } from "../components/TemplateCard";
import { withTemplateSocialImage } from "../seo";

export const meta = () =>
  withTemplateSocialImage(
    [
      {
        title: "Agent-Native Clips — Open-Source Loom Alternative",
      },
      {
        name: "description",
        content:
          "One-click screen recording with captured browser debug logs — console errors and failed network requests recorded alongside the video. Paste a Clips link into an agent and it reads the transcript, summaries, and timestamped frames to fix the bug.",
      },
      {
        property: "og:title",
        content: "Agent-Native Clips — Open-Source Loom Alternative",
      },
      {
        property: "og:description",
        content:
          "Screen recordings with browser debug capture, meeting notes, and dictation — all transcribed, summarized, and shareable with agents as transcript plus timestamped visuals.",
      },
      {
        name: "keywords",
        content:
          "screen recording, async video, open source screen recorder, bug reporting, browser debug logs, console logs, network requests, repro video, jam alternative, AI transcripts, AI video summaries, agent-readable video links, agent-friendly Loom, agent-native clips, meeting notes, meeting recorder, granola alternative, wisprflow alternative, loom alternative, voice dictation, voice to text, push to talk dictation, calendar sync, action items, transcription, video messaging, async communication, shareable video links",
      },
    ],
    "Clips",
  );

const template = templates.find((t) => t.slug === "clips")!;
const CLIPS_PROMPT_URL = "https://clips.agent-native.com/share/B0AgxdvzuZ7H";
const CLIPS_PROMPT_INSTRUCTION =
  "Tell me the most impactful way I could be using agent-native clips in my own work projects this week.";
const AI_PROMPT = `Watch ${CLIPS_PROMPT_URL}. ${CLIPS_PROMPT_INSTRUCTION}`;

const CLIP_PREVIEWS = [
  {
    title: "Introducing Agent-Native Clips",
    href: "https://clips.agent-native.com/share/B0AgxdvzuZ7H",
    thumbnail: "/clips/B0AgxdvzuZ7H.jpg",
  },
  {
    title: "Show Claude how to perform a task",
    href: "https://clips.agent-native.com/share/U1f0uKYYKGF2",
    thumbnail: "/clips/U1f0uKYYKGF2.jpg",
  },
  {
    title: "Record browser workflows with Clips",
    href: "https://clips.agent-native.com/share/1J2KR4ryo2Wg",
    thumbnail: "/clips/1J2KR4ryo2Wg.jpg",
  },
];

const COMPARISON_ROWS = [
  {
    feature: "Can AI read it?",
    clips: "Yes.\nTranscript, summary, frames, & debug.",
    loom: "No.",
    alternatives: "No.",
  },
  {
    feature: "Who owns the data?",
    clips: "You.",
    loom: "Atlassian.",
    alternatives: "Them.",
  },
  {
    feature: "Can it integrate?",
    clips: "Yes.\nChatGPT, Claude, or any API.",
    loom: "Atlassian products + select partners.",
    alternatives: "Select partners.",
  },
];

function ClipPreviewSlider() {
  const sliderRef = useRef<HTMLDivElement>(null);

  function scroll(direction: -1 | 1) {
    const slider = sliderRef.current;
    if (!slider) return;
    slider.scrollBy({
      left: direction * slider.clientWidth * 0.8,
      behavior: "smooth",
    });
  }

  return (
    <div className="mx-auto max-w-5xl text-left">
      <div className="mb-4 flex justify-end gap-2">
        <button
          type="button"
          aria-label="Previous clip"
          onClick={() => scroll(-1)}
          className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-[var(--docs-border)] text-[var(--fg)] transition hover:border-[var(--fg-secondary)]"
        >
          <span aria-hidden>←</span>
        </button>
        <button
          type="button"
          aria-label="Next clip"
          onClick={() => scroll(1)}
          className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-[var(--docs-border)] text-[var(--fg)] transition hover:border-[var(--fg-secondary)]"
        >
          <span aria-hidden>→</span>
        </button>
      </div>
      <div
        ref={sliderRef}
        className="flex snap-x snap-mandatory gap-4 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {CLIP_PREVIEWS.map((clip) => (
          <a
            key={clip.href}
            href={clip.href}
            target="_blank"
            rel="noopener noreferrer"
            className="group min-w-[82%] snap-start overflow-hidden rounded-xl border border-[var(--docs-border)] bg-[var(--bg-secondary)] text-[var(--fg)] no-underline transition hover:border-[var(--fg-secondary)] hover:no-underline sm:min-w-[46%] lg:min-w-[31%]"
            onClick={() =>
              trackEvent("view clip preview", {
                clip: clip.href,
                location: "landing_page_cta",
              })
            }
          >
            <div className="relative aspect-[4/3] overflow-hidden border-b border-[var(--docs-border)] bg-black">
              <img
                src={clip.thumbnail}
                alt=""
                loading="lazy"
                decoding="async"
                className="h-full w-full object-cover object-bottom transition duration-300 group-hover:scale-[1.02]"
              />
              <span className="absolute inset-0 flex items-center justify-center">
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-black/75 text-xl text-white shadow-lg transition group-hover:scale-105">
                  <span className="ml-0.5" aria-hidden>
                    ▶
                  </span>
                </span>
              </span>
            </div>
            <div className="p-4">
              <h3 className="m-0 text-base font-semibold leading-snug">
                {clip.title}
              </h3>
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}

export default function ClipsTemplate() {
  const t = useT();
  const { locale } = useLocale();
  const [aiPromptCopied, setAiPromptCopied] = useState(false);

  function handleCopyAiPrompt() {
    navigator.clipboard.writeText(AI_PROMPT);
    setAiPromptCopied(true);
    trackEvent("copy cli command", {
      template: template.slug,
      location: "landing_page_prompt",
    });
    setTimeout(() => setAiPromptCopied(false), 2000);
  }

  return (
    <main className="template-detail-page mx-auto w-full max-w-[1200px] overflow-x-clip px-4 sm:px-6">
      {/* Hero */}
      <section className="py-12 sm:py-16 lg:py-20">
        <div className="relative overflow-hidden border border-[var(--docs-border)]">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 hidden lg:grid lg:grid-cols-3"
          >
            <div />
            <div className="border-x border-[var(--docs-border)]" />
            <div />
          </div>

          <div className="relative grid gap-3 px-6 pb-10 pt-12 sm:gap-4 sm:px-10 sm:pb-14 sm:pt-16 lg:grid-cols-3 lg:gap-6 lg:pb-20 lg:pt-24">
            <p
              className="font-mono text-sm font-semibold uppercase tracking-[0.14em] lg:col-start-1 lg:row-start-1"
              style={{ color: template.color }}
            >
              Agent-Native {template.name}
            </p>

            <h1 className="text-[2rem] font-medium leading-[1.05] tracking-tight sm:text-4xl lg:col-span-2 lg:col-start-1 lg:row-start-2 lg:text-[2.875rem]">
              <span className="text-[var(--fg)]">
                Screen recordings your AI{" "}
              </span>
              <span className="text-[var(--fg-secondary)]">
                can actually watch
              </span>
            </h1>

            <div className="lg:col-start-3 lg:row-start-2 lg:self-center lg:ps-8">
              <p className="max-w-[300px] text-sm leading-relaxed text-[var(--fg-secondary)]">
                {t("templateLanding.clips.s008")}
              </p>
            </div>
          </div>

          <div className="relative border-t border-[var(--docs-border)]">
            <img
              src={template.screenshot}
              alt={t("templateLanding.clips.s001")}
              loading="lazy"
              decoding="async"
              className="h-auto max-h-[536px] w-full object-cover object-top"
            />
          </div>
        </div>
      </section>

      {/* Try with AI */}
      <section
        id="try-with-ai"
        className="scroll-mt-24 border-t border-[#1a1a1a] bg-[#0a0a0a]"
      >
        <div
          aria-hidden="true"
          className="hidden h-20 border-x border-[#1a1a1a] lg:grid lg:grid-cols-3"
        >
          <div />
          <div className="border-x border-[#1a1a1a]" />
          <div />
        </div>

        <div className="flex flex-col border-y border-[#1a1a1a] lg:flex-row lg:items-stretch">
          <div className="flex items-center border-b border-[#1a1a1a] px-6 py-8 sm:px-10 lg:w-[416px] lg:shrink-0 lg:border-b-0 lg:border-e lg:py-0 lg:ps-8 lg:pe-16">
            <h2 className="max-w-[320px] font-sans text-2xl font-medium leading-[1.3] tracking-[-0.24px] text-[#faf9f5]">
              Try pasting this into Claude, ChatGPT, or Cursor:
            </h2>
          </div>

          <div className="flex flex-1 items-center gap-6 px-6 py-8 sm:px-10 lg:py-8">
            <p className="min-w-0 flex-1 font-mono text-[15px] leading-6 text-[#9a9997] sm:text-lg">
              <span>Watch </span>
              <span className="text-white">
                {CLIPS_PROMPT_URL}.
              </span>
              <span> {CLIPS_PROMPT_INSTRUCTION}</span>
            </p>

            <button
              type="button"
              onClick={handleCopyAiPrompt}
              aria-label="Copy prompt"
              className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-md border border-[#3a3a3a] bg-[#1d1d1d] text-[#faf9f5] transition hover:border-[var(--fg-secondary)]"
            >
              {aiPromptCopied ? (
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : (
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 18 18"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M14.4375 7.5C14.4375 7.25136 14.3387 7.01297 14.1628 6.83716C13.987 6.66134 13.7486 6.5625 13.5 6.5625H7.5C7.25136 6.5625 7.01297 6.66134 6.83716 6.83716C6.66134 7.01297 6.5625 7.25136 6.5625 7.5V13.5C6.5625 13.7486 6.66134 13.987 6.83716 14.1628C7.01297 14.3387 7.25136 14.4375 7.5 14.4375H13.5C13.7486 14.4375 13.987 14.3387 14.1628 14.1628C14.3387 13.987 14.4375 13.7486 14.4375 13.5V7.5ZM11.4375 4.5C11.4375 4.25136 11.3387 4.01297 11.1628 3.83716C10.987 3.66134 10.7486 3.5625 10.5 3.5625H4.5C4.25136 3.5625 4.01297 3.66134 3.83716 3.83716C3.66134 4.01297 3.5625 4.25136 3.5625 4.5V10.5C3.5625 10.7486 3.66134 10.987 3.83716 11.1628C4.01297 11.3387 4.25136 11.4375 4.5 11.4375H5.4375V7.5C5.4375 6.95299 5.65495 6.42854 6.04175 6.04175C6.42854 5.65495 6.95299 5.4375 7.5 5.4375H11.4375V4.5ZM12.5625 5.4375H13.5C14.047 5.4375 14.5715 5.65495 14.9583 6.04175C15.345 6.42854 15.5625 6.95299 15.5625 7.5V13.5C15.5625 14.047 15.345 14.5715 14.9583 14.9583C14.5715 15.345 14.047 15.5625 13.5 15.5625H7.5C6.95299 15.5625 6.42854 15.345 6.04175 14.9583C5.65495 14.5715 5.4375 14.047 5.4375 13.5V12.5625H4.5C3.95299 12.5625 3.42854 12.345 3.04175 11.9583C2.65495 11.5715 2.4375 11.047 2.4375 10.5V4.5C2.4375 3.95299 2.65495 3.42854 3.04175 3.04175C3.42854 2.65495 3.95299 2.4375 4.5 2.4375H10.5C11.047 2.4375 11.5715 2.65495 11.9583 3.04175C12.345 3.42854 12.5625 3.95299 12.5625 4.5V5.4375Z"
                    fill="#FAF9F5"
                  />
                </svg>
              )}
            </button>
          </div>
        </div>
      </section>

      {/* By the numbers */}
      <section className="border-t border-[var(--docs-border)] py-16">
        <div className="grid overflow-hidden rounded-xl border border-[var(--docs-border)] sm:grid-cols-3">
          {[
            { title: "Record", caption: "Share your screen", bg: "var(--bg)" },
            {
              title: "AI Agents",
              caption: "Can See + Hear",
              bg: "var(--bg-secondary)",
            },
            {
              title: "Auto",
              caption: t("templateLanding.clips.s003"),
              bg: "var(--bg)",
            },
          ].map((stat, index) => (
            <div
              key={stat.title}
              className={`flex min-h-[220px] flex-col justify-center gap-3 border-[var(--docs-border)] p-8 sm:min-h-[260px] sm:p-10 ${
                index > 0 ? "border-t sm:border-t-0 sm:border-s" : ""
              }`}
              style={{ background: stat.bg }}
            >
              <div className="text-3xl font-medium tracking-tight text-[var(--fg)] sm:text-4xl">
                {stat.title}
              </div>
              <div className="text-lg text-[var(--fg-secondary)] sm:text-xl">
                {stat.caption}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Core capabilities */}
      <section className="border-t border-[var(--docs-border)] py-16">
        <h2 className="mb-3 text-2xl font-bold tracking-tight">
          {t("templateLanding.clips.s010")}
        </h2>
        <p className="mb-8 max-w-2xl text-base text-[var(--fg-secondary)]">
          {t("templateLanding.clips.s011")}
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-[var(--docs-border)] bg-[var(--bg-secondary)] p-5">
            <div className="mb-3 text-[var(--docs-accent)]">
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="10" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </div>
            <h3 className="mb-1 text-sm font-semibold">
              {t("templateLanding.clips.s012")}
            </h3>
            <p className="m-0 text-sm text-[var(--fg-secondary)]">
              Loom-style. Capture screen, camera, and microphone in a single
              take. Pause, resume, trim, and share with a link the moment you
              stop.
            </p>
          </div>
          <div className="rounded-xl border border-[var(--docs-border)] bg-[var(--bg-secondary)] p-5">
            <div className="mb-3 text-[var(--docs-accent)]">
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
              </svg>
            </div>
            <h3 className="mb-1 text-sm font-semibold">
              {t("templateLanding.clips.s013")}
            </h3>
            <p className="m-0 text-sm text-[var(--fg-secondary)]">
              {t("templateLanding.clips.s014")}
            </p>
          </div>
          <div className="rounded-xl border border-[var(--docs-border)] bg-[var(--bg-secondary)] p-5">
            <div className="mb-3 text-[var(--docs-accent)]">
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="4 17 10 11 4 5" />
                <line x1="12" y1="19" x2="20" y2="19" />
              </svg>
            </div>
            <h3 className="mb-1 text-sm font-semibold">
              {t("templateLanding.clips.s003")}
            </h3>
            <p className="m-0 text-sm text-[var(--fg-secondary)]">
              Jam-style. Record a bug in your browser and Clips captures the
              console errors and failed network requests alongside the video —
              redacted, never headers, bodies, or cookies. Hand the link to an
              agent and it has the repro plus the logs to fix the issue.
            </p>
          </div>
          <div className="rounded-xl border border-[var(--docs-border)] bg-[var(--bg-secondary)] p-5">
            <div className="mb-3 text-[var(--docs-accent)]">
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </div>
            <h3 className="mb-1 text-sm font-semibold">
              {t("templateLanding.clips.s015")}
            </h3>
            <p className="m-0 text-sm text-[var(--fg-secondary)]">
              Wisprflow-style. Hold Fn anywhere on your machine, speak, and the
              cleaned-up text lands in whatever app you're in. Every dictation
              kept in a searchable history.
            </p>
          </div>
        </div>
      </section>

      {/* Library + Search split */}
      <section className="border-t border-[var(--docs-border)] py-16">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-[var(--docs-border)] p-6">
            <h3 className="mb-2 text-base font-semibold">
              {t("templateLanding.clips.s016")}
            </h3>
            <p className="mb-4 text-sm text-[var(--fg-secondary)]">
              {t("templateLanding.clips.s017")}
            </p>
            <ul className="m-0 list-none space-y-2 p-0 text-sm text-[var(--fg-secondary)]">
              <li className="flex items-start gap-2">
                <svg
                  className="mt-0.5 shrink-0 text-[var(--docs-accent)]"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                {t("templateLanding.clips.s018")}
              </li>
              <li className="flex items-start gap-2">
                <svg
                  className="mt-0.5 shrink-0 text-[var(--docs-accent)]"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                {t("templateLanding.clips.s019")}
              </li>
              <li className="flex items-start gap-2">
                <svg
                  className="mt-0.5 shrink-0 text-[var(--docs-accent)]"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                {t("templateLanding.clips.s020")}
              </li>
            </ul>
          </div>
          <div className="rounded-xl border border-[var(--docs-border)] p-6">
            <h3 className="mb-2 text-base font-semibold">
              {t("templateLanding.clips.s021")}
            </h3>
            <p className="mb-4 text-sm text-[var(--fg-secondary)]">
              {t("templateLanding.clips.s022")}
            </p>
            <ul className="m-0 list-none space-y-2 p-0 text-sm text-[var(--fg-secondary)]">
              <li className="flex items-start gap-2">
                <svg
                  className="mt-0.5 shrink-0 text-[var(--docs-accent)]"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                {t("templateLanding.clips.s023")}
              </li>
              <li className="flex items-start gap-2">
                <svg
                  className="mt-0.5 shrink-0 text-[var(--docs-accent)]"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                {t("templateLanding.clips.s024")}
              </li>
              <li className="flex items-start gap-2">
                <svg
                  className="mt-0.5 shrink-0 text-[var(--docs-accent)]"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                {t("templateLanding.clips.s025")}
              </li>
            </ul>
          </div>
        </div>
      </section>

      {/* Agent actions */}
      <section className="border-t border-[var(--docs-border)] py-16">
        <div className="grid gap-8 lg:grid-cols-2 lg:items-center">
          <div>
            <h2 className="mb-3 text-2xl font-bold tracking-tight">
              {t("templateLanding.clips.s026")}
            </h2>
            <p className="mb-6 text-base text-[var(--fg-secondary)]">
              {t("templateLanding.clips.s027")}
            </p>
            <ul className="m-0 list-none space-y-3 p-0 text-sm text-[var(--fg-secondary)]">
              <li className="flex items-start gap-2">
                <svg
                  className="mt-0.5 shrink-0 text-[var(--docs-accent)]"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                {t("templateLanding.clips.s028")}
              </li>
              <li className="flex items-start gap-2">
                <svg
                  className="mt-0.5 shrink-0 text-[var(--docs-accent)]"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                {t("templateLanding.clips.s029")}
              </li>
              <li className="flex items-start gap-2">
                <svg
                  className="mt-0.5 shrink-0 text-[var(--docs-accent)]"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                {t("templateLanding.clips.s030")}
              </li>
              <li className="flex items-start gap-2">
                <svg
                  className="mt-0.5 shrink-0 text-[var(--docs-accent)]"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                {t("templateLanding.clips.s031")}
              </li>
            </ul>
          </div>
          <div className="rounded-xl border border-[var(--docs-border)] bg-[var(--bg-secondary)] p-6">
            <div className="space-y-3 font-mono text-sm">
              <div className="text-[var(--fg-secondary)]">
                {"// Available agent actions"}
              </div>
              <div>
                <span className="text-[var(--docs-accent)]">$</span>{" "}
                <span className="text-[var(--fg)]">
                  pnpm action transcribe --clip latest
                </span>
              </div>
              <div>
                <span className="text-[var(--docs-accent)]">$</span>{" "}
                <span className="text-[var(--fg)]">
                  pnpm action finalize-meeting --id today-standup
                </span>
              </div>
              <div>
                <span className="text-[var(--docs-accent)]">$</span>{" "}
                <span className="text-[var(--fg)]">
                  pnpm action list-dictations --since 7d
                </span>
              </div>
              <div>
                <span className="text-[var(--docs-accent)]">$</span>{" "}
                <span className="text-[var(--fg)]">
                  pnpm action search --query "pricing"
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Comparison table */}
      <section
        id="comparison"
        className="scroll-mt-24 border-t border-[var(--docs-border)] py-16"
      >
        <h2 className="mb-8 text-2xl font-bold tracking-tight">
          {t("templateLanding.clips.s032")}
        </h2>
        <div className="overflow-x-auto rounded-xl border border-[var(--docs-border)]">
          <table className="comparison-table min-w-[42rem] w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--docs-border)] bg-[var(--bg-secondary)]">
                <th className="w-[18%] px-5 py-3 text-left font-semibold text-[var(--fg)]"></th>
                <th className="w-[30%] px-5 py-3 text-left font-semibold text-[var(--docs-accent)]">
                  Agent-Native Clips
                </th>
                <th className="w-[20%] px-5 py-3 text-left font-semibold text-[var(--fg-secondary)]">
                  Loom
                </th>
                <th className="w-[32%] px-5 py-3 text-left font-semibold text-[var(--fg-secondary)]">
                  Tella, Screenpal, Vidyard
                </th>
              </tr>
            </thead>
            <tbody className="text-[var(--fg-secondary)]">
              {COMPARISON_ROWS.map((row) => (
                <tr
                  key={row.feature}
                  className="border-b border-[var(--docs-border)] align-top"
                >
                  <td className="px-5 py-4 font-medium text-[var(--fg)]">
                    {row.feature}
                  </td>
                  <td className="whitespace-pre-line px-5 py-4 text-[var(--fg)]">
                    {row.clips}
                  </td>
                  <td className="px-5 py-4">{row.loom}</td>
                  <td className="px-5 py-4">{row.alternatives}</td>
                </tr>
              ))}
              <tr>
                <td className="px-5 py-4 font-medium text-[var(--fg)]">
                  {t("templateLanding.clips.s053")}
                </td>
                <td className="px-5 py-4 text-[var(--fg)]">
                  {t("templateLanding.clips.s058")}
                </td>
                <td className="px-5 py-4">{t("templateLanding.clips.s054")}</td>
                <td className="px-5 py-4">{t("templateLanding.clips.s055")}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* CTA */}
      <section
        id="start-now"
        className="border-t border-[var(--docs-border)] py-16 text-center"
      >
        <h2 className="mb-3 text-2xl font-bold tracking-tight">
          {t("templateLanding.clips.s059")}
        </h2>
        <ClipPreviewSlider />
        <div className="template-detail-cta-actions mt-8 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center sm:gap-4">
          <TemplateDocsLink
            template={template}
            location="landing_page_cta"
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-[var(--docs-border)] px-6 py-3 text-sm font-medium text-[var(--fg)] no-underline transition hover:border-[var(--fg-secondary)] hover:no-underline"
          >
            {t("templateLanding.clips.s061")}
          </TemplateDocsLink>
          <Link
            data-an-prefetch="viewport"
            to={sitePathForLocale("/apps", locale)}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-[var(--docs-border)] px-6 py-3 text-sm font-medium text-[var(--fg)] no-underline transition hover:border-[var(--fg-secondary)] hover:no-underline"
          >
            {t("templateLanding.clips.s062")}
          </Link>
        </div>
      </section>
    </main>
  );
}
