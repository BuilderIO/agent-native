import { useT } from "@agent-native/core/client";
import { useState } from "react";
import { Link } from "react-router";

import { TemplateDocsLink } from "../components/template-docs";
import { templates, trackEvent } from "../components/TemplateCard";
import { withTemplateSocialImage } from "../seo";

export const meta = () =>
  withTemplateSocialImage(
    [
      { title: "Agent-Native Slides — Open Source AI Presentation Builder" },
      {
        name: "description",
        content:
          "Generate and edit presentations with AI. Open source alternative to Google Slides and Pitch. Create slide decks via natural language with visual editing, 8 layouts, image generation, logo search, sharing, and presentation mode.",
      },
      {
        property: "og:title",
        content: "Agent-Native Slides — Open Source AI Presentation Builder",
      },
      {
        property: "og:description",
        content:
          "Generate and edit presentations with AI. Create slide decks via natural language.",
      },
      {
        name: "keywords",
        content:
          "AI presentation maker, AI slide generator, open source Google Slides alternative, Pitch alternative, AI PowerPoint, AI deck builder, agent-native slides, AI presentation tool, AI slide deck, prompt to presentation",
      },
    ],
    "Slides",
  );

const template = templates.find((t) => t.slug === "slides")!;

function CliCopy() {
  const [copied, setCopied] = useState(false);
  function handleCopy() {
    navigator.clipboard.writeText(template.cliCommand);
    setCopied(true);
    trackEvent("copy cli command", {
      template: template.slug,
      location: "landing_page",
    });
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <button
      onClick={handleCopy}
      data-template-cli-copy
      className="group col-span-full flex w-full min-w-0 max-w-full items-center gap-3 rounded-lg border border-[var(--code-border)] bg-[var(--code-bg)] px-4 py-3 font-mono text-sm transition hover:border-[var(--fg-secondary)] sm:w-auto sm:max-w-[min(100%,36rem)] sm:px-5"
    >
      <span className="shrink-0 text-[var(--fg-secondary)]">$</span>
      <span
        data-template-cli-copy-text
        className="min-w-0 truncate text-[var(--fg)]"
      >
        {template.cliCommand}
      </span>
      <span className="ml-auto shrink-0 text-[var(--fg-secondary)] opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100">
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

export default function SlidesTemplate() {
  const t = useT();
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
              {t("templateLanding.slides.s006")}
            </h1>

            <p className="mb-6 text-base leading-7 text-[var(--fg-secondary)] sm:text-lg sm:leading-relaxed">
              {t("templateLanding.slides.s007")}
            </p>

            <div className="template-detail-actions mb-8 grid grid-cols-2 items-stretch gap-3 sm:flex sm:flex-wrap sm:items-center">
              <a
                href="https://slides.agent-native.com"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-full bg-black px-6 py-3 text-sm font-medium text-white no-underline transition hover:bg-gray-800 hover:no-underline dark:bg-white dark:text-black dark:hover:bg-gray-200"
                onClick={() =>
                  trackEvent("try live demo", {
                    template: "slides",
                    location: "landing_page",
                  })
                }
              >
                {t("templateLanding.slides.s008")}
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
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
              </a>
              <TemplateDocsLink template={template} location="landing_page" />
              <CliCopy />
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-[var(--docs-border)] bg-[var(--bg-secondary)]">
            <img
              src={template.screenshot}
              alt={t("templateLanding.slides.s001")}
              className="w-full object-cover object-top"
            />
          </div>
        </div>
      </section>

      {/* How it works - numbered steps */}
      <section className="border-t border-[var(--docs-border)] py-16">
        <h2 className="mb-8 text-2xl font-bold tracking-tight">
          {t("templateLanding.slides.s009")}
        </h2>
        <div className="mx-auto grid max-w-3xl gap-6 sm:grid-cols-3">
          {[
            {
              step: "1",
              title: t("templateLanding.slides.s002"),
              desc: "Tell the agent your topic, audience, and tone. Attach reference PDFs or images.",
            },
            {
              step: "2",
              title: t("templateLanding.slides.s003"),
              desc: "The agent builds a complete deck — structure, content, layouts, and image prompts.",
            },
            {
              step: "3",
              title: t("templateLanding.slides.s004"),
              desc: "Edit visually, conversationally, or in code. Changes appear through polling sync.",
            },
          ].map((s) => (
            <div key={s.step} className="text-center">
              <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-[var(--docs-accent)] text-sm font-bold text-white">
                {s.step}
              </div>
              <h3 className="mb-1 text-sm font-semibold">{s.title}</h3>
              <p className="m-0 text-sm text-[var(--fg-secondary)]">{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Core features - icon cards */}
      <section className="border-t border-[var(--docs-border)] py-16">
        <h2 className="mb-3 text-2xl font-bold tracking-tight">
          {t("templateLanding.slides.s010")}
        </h2>
        <p className="mb-8 max-w-2xl text-base text-[var(--fg-secondary)]">
          {t("templateLanding.slides.s011")}
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-xl border border-[var(--docs-border)] bg-[var(--bg-secondary)] p-5">
            <h3 className="mb-1 text-sm font-semibold">
              {t("templateLanding.slides.s012")}
            </h3>
            <p className="m-0 text-sm text-[var(--fg-secondary)]">
              {t("templateLanding.slides.s013")}
            </p>
          </div>
          <div className="rounded-xl border border-[var(--docs-border)] bg-[var(--bg-secondary)] p-5">
            <h3 className="mb-1 text-sm font-semibold">
              {t("templateLanding.slides.s014")}
            </h3>
            <p className="m-0 text-sm text-[var(--fg-secondary)]">
              {t("templateLanding.slides.s015")}
            </p>
          </div>
          <div className="rounded-xl border border-[var(--docs-border)] bg-[var(--bg-secondary)] p-5">
            <h3 className="mb-1 text-sm font-semibold">
              {t("templateLanding.slides.s016")}
            </h3>
            <p className="m-0 text-sm text-[var(--fg-secondary)]">
              {t("templateLanding.slides.s017")}
            </p>
          </div>
          <div className="rounded-xl border border-[var(--docs-border)] bg-[var(--bg-secondary)] p-5">
            <h3 className="mb-1 text-sm font-semibold">
              {t("templateLanding.slides.s018")}
            </h3>
            <p className="m-0 text-sm text-[var(--fg-secondary)]">
              {t("templateLanding.slides.s019")}
            </p>
          </div>
          <div className="rounded-xl border border-[var(--docs-border)] bg-[var(--bg-secondary)] p-5">
            <h3 className="mb-1 text-sm font-semibold">
              {t("templateLanding.slides.s020")}
            </h3>
            <p className="m-0 text-sm text-[var(--fg-secondary)]">
              {t("templateLanding.slides.s021")}
            </p>
          </div>
          <div className="rounded-xl border border-[var(--docs-border)] bg-[var(--bg-secondary)] p-5">
            <h3 className="mb-1 text-sm font-semibold">
              {t("templateLanding.slides.s022")}
            </h3>
            <p className="m-0 text-sm text-[var(--fg-secondary)]">
              {t("templateLanding.slides.s023")}
            </p>
          </div>
        </div>
      </section>

      {/* Two-column highlight */}
      <section className="border-t border-[var(--docs-border)] py-16">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-[var(--docs-border)] p-6">
            <h3 className="mb-2 text-base font-semibold">
              {t("templateLanding.slides.s024")}
            </h3>
            <p className="mb-4 text-sm text-[var(--fg-secondary)]">
              {t("templateLanding.slides.s025")}
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
                {t("templateLanding.slides.s026")}
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
                {t("templateLanding.slides.s027")}
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
                {t("templateLanding.slides.s028")}
              </li>
            </ul>
          </div>
          <div className="rounded-xl border border-[var(--docs-border)] p-6">
            <h3 className="mb-2 text-base font-semibold">
              {t("templateLanding.slides.s029")}
            </h3>
            <p className="mb-4 text-sm text-[var(--fg-secondary)]">
              {t("templateLanding.slides.s030")}
            </p>
            <div className="space-y-3 rounded-lg bg-[var(--bg-secondary)] p-4 font-mono text-sm">
              <div className="text-[var(--fg-secondary)]">
                {t("templateLanding.slides.s031")}
              </div>
              <div className="text-[var(--fg-secondary)]">
                {t("templateLanding.slides.s032")}
              </div>
              <div className="text-[var(--fg-secondary)]">
                {t("templateLanding.slides.s033")}
              </div>
              <div className="text-[var(--fg-secondary)]">
                {t("templateLanding.slides.s034")}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Comparison table */}
      <section className="border-t border-[var(--docs-border)] py-16">
        <h2 className="mb-8 text-2xl font-bold tracking-tight">
          {t("templateLanding.slides.s035")}
        </h2>
        <div className="overflow-x-auto rounded-xl border border-[var(--docs-border)]">
          <table className="comparison-table min-w-[42rem] w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--docs-border)] bg-[var(--bg-secondary)]">
                <th className="px-5 py-3 text-left font-semibold text-[var(--fg)]"></th>
                <th className="px-5 py-3 text-left font-semibold text-[var(--fg-secondary)]">
                  Google Slides / Pitch
                </th>
                <th className="px-5 py-3 text-left font-semibold text-[var(--fg-secondary)]">
                  {t("templateLanding.slides.s036")}
                </th>
                <th className="px-5 py-3 text-left font-semibold text-[var(--docs-accent)]">
                  Agent-Native Slides
                </th>
              </tr>
            </thead>
            <tbody className="text-[var(--fg-secondary)]">
              <tr className="border-b border-[var(--docs-border)]">
                <td className="px-5 py-3 font-medium text-[var(--fg)]">
                  {t("templateLanding.slides.s037")}
                </td>
                <td className="px-5 py-3">
                  {t("templateLanding.slides.s038")}
                </td>
                <td className="px-5 py-3">
                  {t("templateLanding.slides.s039")}
                </td>
                <td className="px-5 py-3 text-[var(--fg)]">
                  {t("templateLanding.slides.s040")}
                </td>
              </tr>
              <tr className="border-b border-[var(--docs-border)]">
                <td className="px-5 py-3 font-medium text-[var(--fg)]">
                  {t("templateLanding.slides.s041")}
                </td>
                <td className="px-5 py-3">
                  {t("templateLanding.slides.s042")}
                </td>
                <td className="px-5 py-3">
                  {t("templateLanding.slides.s043")}
                </td>
                <td className="px-5 py-3 text-[var(--fg)]">
                  {t("templateLanding.slides.s044")}
                </td>
              </tr>
              <tr className="border-b border-[var(--docs-border)]">
                <td className="px-5 py-3 font-medium text-[var(--fg)]">
                  {t("templateLanding.slides.s045")}
                </td>
                <td className="px-5 py-3">None</td>
                <td className="px-5 py-3">
                  {t("templateLanding.slides.s046")}
                </td>
                <td className="px-5 py-3 text-[var(--fg)]">
                  Gemini with style refs
                </td>
              </tr>
              <tr className="border-b border-[var(--docs-border)]">
                <td className="px-5 py-3 font-medium text-[var(--fg)]">
                  {t("templateLanding.slides.s047")}
                </td>
                <td className="px-5 py-3">
                  {t("templateLanding.slides.s048")}
                </td>
                <td className="px-5 py-3">
                  {t("templateLanding.slides.s049")}
                </td>
                <td className="px-5 py-3 text-[var(--fg)]">
                  {t("templateLanding.slides.s050")}
                </td>
              </tr>
              <tr>
                <td className="px-5 py-3 font-medium text-[var(--fg)]">
                  {t("templateLanding.slides.s051")}
                </td>
                <td className="px-5 py-3">
                  {t("templateLanding.slides.s052")}
                </td>
                <td className="px-5 py-3">
                  {t("templateLanding.slides.s053")}
                </td>
                <td className="px-5 py-3 text-[var(--fg)]">
                  {t("templateLanding.slides.s054")}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-[var(--docs-border)] py-16 text-center">
        <h2 className="mb-3 text-2xl font-bold tracking-tight">
          {t("templateLanding.slides.s055")}
        </h2>
        <p className="mx-auto mb-8 max-w-lg text-base text-[var(--fg-secondary)]">
          {t("templateLanding.slides.s056")}
        </p>
        <div className="template-detail-cta-actions flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center sm:gap-4">
          <TemplateDocsLink
            template={template}
            location="landing_page_cta"
            className="inline-flex items-center gap-2 rounded-full bg-black px-6 py-3 text-sm font-medium text-white no-underline transition hover:bg-gray-800 hover:no-underline dark:bg-white dark:text-black dark:hover:bg-gray-200"
          >
            {t("templateLanding.slides.s057")}
          </TemplateDocsLink>
          <Link
            data-an-prefetch="render"
            to="/templates"
            className="inline-flex items-center gap-2 rounded-full border border-[var(--docs-border)] px-6 py-3 text-sm font-medium text-[var(--fg)] no-underline transition hover:border-[var(--fg-secondary)] hover:no-underline"
          >
            {t("templateLanding.slides.s058")}
          </Link>
        </div>
      </section>
    </main>
  );
}
