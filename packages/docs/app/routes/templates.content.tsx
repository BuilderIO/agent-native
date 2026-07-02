import { useLocale, useT } from "@agent-native/core/client";
import { useState } from "react";
import { Link } from "react-router";

import { sitePathForLocale } from "../components/docs-locale";
import { TemplateDocsLink } from "../components/template-docs";
import { templates, trackEvent } from "../components/TemplateCard";
import { withTemplateSocialImage } from "../seo";

export const meta = () =>
  withTemplateSocialImage(
    [
      {
        title: "Agent-Native Content — Open Source Obsidian for MDX",
      },
      {
        name: "description",
        content:
          "Edit local Markdown/MDX files like Obsidian, generate rich interactive custom MDX blocks, and write with an AI agent that knows your docs.",
      },
      {
        property: "og:title",
        content: "Agent-Native Content — Open Source Obsidian for MDX",
      },
      {
        property: "og:description",
        content:
          "Local MDX editing, custom interactive blocks, and agent-assisted docs.",
      },
      {
        name: "keywords",
        content:
          "Obsidian for MDX, open source Obsidian alternative, MDX editor, local Markdown editor, AI content editor, open source Notion alternative, Google Docs alternative, AI writing tool, agent-native content, AI-powered CMS, AI document editor, custom MDX blocks",
      },
    ],
    "Content",
  );

const template = templates.find((t) => t.slug === "content")!;

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

export default function ContentTemplate() {
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
              {t("templateLanding.content.s003")}
            </h1>

            <p className="mb-6 text-base leading-7 text-[var(--fg-secondary)] sm:text-lg sm:leading-relaxed">
              {t("templateLanding.content.s004")}
            </p>

            <div className="template-detail-actions mb-8 grid grid-cols-2 items-stretch gap-3 sm:flex sm:flex-wrap sm:items-center">
              <a
                href="https://content.agent-native.com"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-full bg-black px-6 py-3 text-sm font-medium text-white no-underline transition hover:bg-gray-800 hover:no-underline dark:bg-white dark:text-black dark:hover:bg-gray-200"
                onClick={() =>
                  trackEvent("try live demo", {
                    template: "content",
                    location: "landing_page",
                  })
                }
              >
                {t("templateLanding.content.s005")}
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
              alt={t("templateLanding.content.s001")}
              className="w-full object-cover object-top"
            />
          </div>
        </div>
      </section>

      {/* How it works - 3 panels */}
      <section className="border-t border-[var(--docs-border)] py-16">
        <div className="mx-auto grid max-w-3xl gap-px overflow-hidden rounded-xl border border-[var(--docs-border)] bg-[var(--docs-border)] sm:grid-cols-3">
          <div className="bg-[var(--bg)] p-6 text-center">
            <div className="mb-3 flex justify-center text-[var(--docs-accent)]">
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
              </svg>
            </div>
            <div className="mb-1 text-sm font-semibold">
              {t("templateLanding.content.s006")}
            </div>
            <p className="m-0 text-sm text-[var(--fg-secondary)]">
              {t("templateLanding.content.s007")}
            </p>
          </div>
          <div className="bg-[var(--bg)] p-6 text-center">
            <div className="mb-3 flex justify-center text-[#7928ca]">
              <svg
                width="24"
                height="24"
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
            <div className="mb-1 text-sm font-semibold">
              {t("templateLanding.content.s008")}
            </div>
            <p className="m-0 text-sm text-[var(--fg-secondary)]">
              {t("templateLanding.content.s009")}
            </p>
          </div>
          <div className="bg-[var(--bg)] p-6 text-center">
            <div className="mb-3 flex justify-center text-[#f59e0b]">
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                <polyline points="16 6 12 2 8 6" />
                <line x1="12" y1="2" x2="12" y2="15" />
              </svg>
            </div>
            <div className="mb-1 text-sm font-semibold">
              {t("templateLanding.content.s010")}
            </div>
            <p className="m-0 text-sm text-[var(--fg-secondary)]">
              {t("templateLanding.content.s011")}
            </p>
          </div>
        </div>
      </section>

      {/* Core features */}
      <section className="border-t border-[var(--docs-border)] py-16">
        <h2 className="mb-3 text-2xl font-bold tracking-tight">
          {t("templateLanding.content.s012")}
        </h2>
        <p className="mb-8 max-w-2xl text-base text-[var(--fg-secondary)]">
          {t("templateLanding.content.s013")}
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-xl border border-[var(--docs-border)] bg-[var(--bg-secondary)] p-5">
            <h3 className="mb-1 text-sm font-semibold">
              {t("templateLanding.content.s014")}
            </h3>
            <p className="m-0 text-sm text-[var(--fg-secondary)]">
              {t("templateLanding.content.s015")}
            </p>
          </div>
          <div className="rounded-xl border border-[var(--docs-border)] bg-[var(--bg-secondary)] p-5">
            <h3 className="mb-1 text-sm font-semibold">
              {t("templateLanding.content.s016")}
            </h3>
            <p className="m-0 text-sm text-[var(--fg-secondary)]">
              {t("templateLanding.content.s017")}
            </p>
          </div>
          <div className="rounded-xl border border-[var(--docs-border)] bg-[var(--bg-secondary)] p-5">
            <h3 className="mb-1 text-sm font-semibold">Notion Import/Export</h3>
            <p className="m-0 text-sm text-[var(--fg-secondary)]">
              {t("templateLanding.content.s018")}
            </p>
          </div>
          <div className="rounded-xl border border-[var(--docs-border)] bg-[var(--bg-secondary)] p-5">
            <h3 className="mb-1 text-sm font-semibold">
              {t("templateLanding.content.s019")}
            </h3>
            <p className="m-0 text-sm text-[var(--fg-secondary)]">
              {t("templateLanding.content.s020")}
            </p>
          </div>
          <div className="rounded-xl border border-[var(--docs-border)] bg-[var(--bg-secondary)] p-5">
            <h3 className="mb-1 text-sm font-semibold">
              {t("templateLanding.content.s021")}
            </h3>
            <p className="m-0 text-sm text-[var(--fg-secondary)]">
              {t("templateLanding.content.s022")}
            </p>
          </div>
          <div className="rounded-xl border border-[var(--docs-border)] bg-[var(--bg-secondary)] p-5">
            <h3 className="mb-1 text-sm font-semibold">
              {t("templateLanding.content.s023")}
            </h3>
            <p className="m-0 text-sm text-[var(--fg-secondary)]">
              {t("templateLanding.content.s024")}
            </p>
          </div>
          <div className="rounded-xl border border-[var(--docs-border)] bg-[var(--bg-secondary)] p-5">
            <h3 className="mb-1 text-sm font-semibold">
              {t("templateLanding.content.s025")}
            </h3>
            <p className="m-0 text-sm text-[var(--fg-secondary)]">
              {t("templateLanding.content.s026")}
            </p>
          </div>
        </div>
      </section>

      {/* Publishing highlight */}
      <section className="border-t border-[var(--docs-border)] py-16">
        <div className="grid gap-8 lg:grid-cols-2 lg:items-center">
          <div>
            <h2 className="mb-3 text-2xl font-bold tracking-tight">
              {t("templateLanding.content.s027")}
            </h2>
            <p className="mb-6 text-base text-[var(--fg-secondary)]">
              {t("templateLanding.content.s028")}
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
                WordPress, Contentful, Builder, or any CMS
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
                {t("templateLanding.content.s029")}
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
                {t("templateLanding.content.s030")}
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
                {t("templateLanding.content.s031")}
              </li>
            </ul>
          </div>
          <div className="rounded-xl border border-[var(--docs-border)] bg-[var(--bg-secondary)] p-6">
            <div className="space-y-3 font-mono text-sm">
              <div className="text-[var(--fg-secondary)]">
                {"// Agent publishing workflow"}
              </div>
              <div>
                <span className="text-[var(--docs-accent)]">1.</span>{" "}
                <span className="text-[var(--fg)]">
                  {t("templateLanding.content.s032")}
                </span>
              </div>
              <div>
                <span className="text-[var(--docs-accent)]">2.</span>{" "}
                <span className="text-[var(--fg)]">
                  {t("templateLanding.content.s033")}
                </span>
              </div>
              <div>
                <span className="text-[var(--docs-accent)]">3.</span>{" "}
                <span className="text-[var(--fg)]">
                  {t("templateLanding.content.s034")}
                </span>
              </div>
              <div>
                <span className="text-[var(--docs-accent)]">4.</span>{" "}
                <span className="text-[var(--fg)]">
                  {t("templateLanding.content.s035")}
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Comparison table */}
      <section className="border-t border-[var(--docs-border)] py-16">
        <h2 className="mb-8 text-2xl font-bold tracking-tight">
          {t("templateLanding.content.s036")}
        </h2>
        <div className="overflow-x-auto rounded-xl border border-[var(--docs-border)]">
          <table className="comparison-table min-w-[42rem] w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--docs-border)] bg-[var(--bg-secondary)]">
                <th className="px-5 py-3 text-left font-semibold text-[var(--fg)]"></th>
                <th className="px-5 py-3 text-left font-semibold text-[var(--fg-secondary)]">
                  Obsidian / Notion / Google Docs
                </th>
                <th className="px-5 py-3 text-left font-semibold text-[var(--fg-secondary)]">
                  ChatGPT / Claude
                </th>
                <th className="px-5 py-3 text-left font-semibold text-[var(--docs-accent)]">
                  Agent-Native Content
                </th>
              </tr>
            </thead>
            <tbody className="text-[var(--fg-secondary)]">
              <tr className="border-b border-[var(--docs-border)]">
                <td className="px-5 py-3 font-medium text-[var(--fg)]">
                  {t("templateLanding.content.s037")}
                </td>
                <td className="px-5 py-3">
                  {t("templateLanding.content.s038")}
                </td>
                <td className="px-5 py-3">
                  {t("templateLanding.content.s039")}
                </td>
                <td className="px-5 py-3 text-[var(--fg)]">
                  {t("templateLanding.content.s040")}
                </td>
              </tr>
              <tr className="border-b border-[var(--docs-border)]">
                <td className="px-5 py-3 font-medium text-[var(--fg)]">
                  {t("templateLanding.content.s041")}
                </td>
                <td className="px-5 py-3">None</td>
                <td className="px-5 py-3">
                  {t("templateLanding.content.s042")}
                </td>
                <td className="px-5 py-3 text-[var(--fg)]">
                  {t("templateLanding.content.s043")}
                </td>
              </tr>
              <tr className="border-b border-[var(--docs-border)]">
                <td className="px-5 py-3 font-medium text-[var(--fg)]">
                  {t("templateLanding.content.s044")}
                </td>
                <td className="px-5 py-3">
                  {t("templateLanding.content.s045")}
                </td>
                <td className="px-5 py-3">
                  {t("templateLanding.content.s046")}
                </td>
                <td className="px-5 py-3 text-[var(--fg)]">
                  {t("templateLanding.content.s047")}
                </td>
              </tr>
              <tr className="border-b border-[var(--docs-border)]">
                <td className="px-5 py-3 font-medium text-[var(--fg)]">
                  {t("templateLanding.content.s048")}
                </td>
                <td className="px-5 py-3">
                  {t("templateLanding.content.s049")}
                </td>
                <td className="px-5 py-3">
                  {t("templateLanding.content.s046")}
                </td>
                <td className="px-5 py-3 text-[var(--fg)]">
                  {t("templateLanding.content.s050")}
                </td>
              </tr>
              <tr className="border-b border-[var(--docs-border)]">
                <td className="px-5 py-3 font-medium text-[var(--fg)]">
                  {t("templateLanding.content.s051")}
                </td>
                <td className="px-5 py-3">
                  {t("templateLanding.content.s052")}
                </td>
                <td className="px-5 py-3">
                  {t("templateLanding.content.s053")}
                </td>
                <td className="px-5 py-3 text-[var(--fg)]">
                  {t("templateLanding.content.s054")}
                </td>
              </tr>
              <tr>
                <td className="px-5 py-3 font-medium text-[var(--fg)]">
                  {t("templateLanding.content.s055")}
                </td>
                <td className="px-5 py-3">
                  {t("templateLanding.content.s056")}
                </td>
                <td className="px-5 py-3">
                  {t("templateLanding.content.s057")}
                </td>
                <td className="px-5 py-3 text-[var(--fg)]">
                  {t("templateLanding.content.s058")}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-[var(--docs-border)] py-16 text-center">
        <h2 className="mb-3 text-2xl font-bold tracking-tight">
          {t("templateLanding.content.s059")}
        </h2>
        <p className="mx-auto mb-8 max-w-lg text-base text-[var(--fg-secondary)]">
          {t("templateLanding.content.s060")}
        </p>
        <div className="template-detail-cta-actions flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center sm:gap-4">
          <TemplateDocsLink
            template={template}
            location="landing_page_cta"
            className="inline-flex items-center gap-2 rounded-full bg-black px-6 py-3 text-sm font-medium text-white no-underline transition hover:bg-gray-800 hover:no-underline dark:bg-white dark:text-black dark:hover:bg-gray-200"
          >
            {t("templateLanding.content.s061")}
          </TemplateDocsLink>
          <Link
            data-an-prefetch="render"
            to={sitePathForLocale("/apps", locale)}
            className="inline-flex items-center gap-2 rounded-full border border-[var(--docs-border)] px-6 py-3 text-sm font-medium text-[var(--fg)] no-underline transition hover:border-[var(--fg-secondary)] hover:no-underline"
          >
            {t("templateLanding.content.s062")}
          </Link>
        </div>
      </section>
    </main>
  );
}
