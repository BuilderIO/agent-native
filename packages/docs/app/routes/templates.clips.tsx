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
const AI_PROMPT =
  "Watch https://clips.agent-native.com/share/B0AgxdvzuZ7H. Tell me the most impactful way I could be using agent-native clips in my own work projects this week.";

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
            <div className="relative aspect-video overflow-hidden border-b border-[var(--docs-border)] bg-black">
              <img
                src={clip.thumbnail}
                alt=""
                loading="lazy"
                decoding="async"
                className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.02]"
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

function CliCopy({
  value = template.cliCommand,
  location = "landing_page",
  multiline = false,
}: {
  value?: string;
  location?: string;
  multiline?: boolean;
} = {}) {
  const [copied, setCopied] = useState(false);
  function handleCopy() {
    navigator.clipboard.writeText(value);
    setCopied(true);
    trackEvent("copy cli command", {
      template: template.slug,
      location,
    });
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <button
      type="button"
      onClick={handleCopy}
      data-template-cli-copy={multiline ? undefined : true}
      className={`group col-span-full flex w-full min-w-0 max-w-full gap-3 rounded-md border border-[var(--code-border)] bg-[var(--code-bg)] px-4 py-3 font-mono text-sm transition hover:border-[var(--fg-secondary)] sm:px-5 ${
        multiline
          ? "items-start"
          : "items-center sm:w-auto sm:max-w-[min(100%,36rem)]"
      }`}
    >
      {!multiline ? (
        <span className="shrink-0 text-[var(--fg-secondary)]">$</span>
      ) : null}
      <span
        data-template-cli-copy-text={multiline ? undefined : true}
        className={`min-w-0 text-[var(--fg)] ${
          multiline
            ? "flex-1 whitespace-normal text-left leading-relaxed [overflow-wrap:anywhere]"
            : "truncate"
        }`}
      >
        {value}
      </span>
      <span
        className={`ml-auto inline-flex shrink-0 items-center gap-1.5 transition ${
          multiline
            ? "text-[var(--fg)] opacity-100 group-hover:text-[var(--docs-accent)]"
            : "text-[var(--fg-secondary)] opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
        }`}
      >
        {copied ? (
          <svg
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
        ) : (
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
        )}
      </span>
    </button>
  );
}

export default function ClipsTemplate() {
  const t = useT();
  const { locale } = useLocale();
  return (
    <main className="template-detail-page mx-auto w-full max-w-[1200px] overflow-x-clip px-4 sm:px-6">
      {/* Hero */}
      <section className="py-12 sm:py-16 lg:py-20">
        <div className="grid min-w-0 gap-10 lg:grid-cols-2 lg:items-start lg:gap-12">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-[var(--docs-border)] bg-[var(--bg-secondary)] px-3 py-1 text-xs text-[var(--fg-secondary)]">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ background: template.color }}
              />
              Agent-Native {template.name}
            </div>

            <h1 className="mb-4 text-[2rem] font-bold leading-[1.08] tracking-tight sm:text-4xl md:text-5xl">
              {t("templateLanding.clips.s007")}
            </h1>

            <p className="mb-6 text-base leading-7 text-[var(--fg-secondary)] sm:text-lg sm:leading-relaxed">
              {t("templateLanding.clips.s008")}
            </p>
          </div>

          <div className="overflow-hidden rounded-xl border border-[var(--docs-border)] bg-[var(--bg-secondary)]">
            <img
              src={template.screenshot}
              alt={t("templateLanding.clips.s001")}
              loading="lazy"
              decoding="async"
              className="w-full object-cover object-top"
            />
          </div>
        </div>

        <div
          id="try-with-ai"
          className="mx-auto mt-10 max-w-3xl scroll-mt-24 lg:mt-12"
        >
          <h2 className="mb-4 text-2xl font-bold tracking-tight sm:text-3xl">
            Paste this into Claude, ChatGPT, or Cursor:
          </h2>
          <CliCopy value={AI_PROMPT} location="landing_page_prompt" multiline />
        </div>
      </section>

      {/* By the numbers */}
      <section className="border-t border-[var(--docs-border)] py-16">
        <div className="mx-auto grid max-w-3xl gap-px overflow-hidden rounded-xl border border-[var(--docs-border)] bg-[var(--docs-border)] sm:grid-cols-3">
          {[
            { number: "Auto", label: t("templateLanding.clips.s003") },
            { number: "Agent", label: t("templateLanding.clips.s005") },
            { number: "People", label: "Love it too!" },
          ].map((stat) => (
            <div key={stat.label} className="bg-[var(--bg)] p-6 text-center">
              <div className="mb-1 text-2xl font-bold text-[var(--docs-accent)]">
                {stat.number}
              </div>
              <div className="text-sm text-[var(--fg-secondary)]">
                {stat.label}
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
