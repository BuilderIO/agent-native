import { useT } from "@agent-native/core/client";
import { useState } from "react";
import { Link } from "react-router";

import { TemplateDocsLink } from "../components/template-docs";
import { templates, trackEvent } from "../components/TemplateCard";
import { withTemplateSocialImage } from "../seo";

export const meta = () =>
  withTemplateSocialImage(
    [
      {
        title:
          "Agent-Native Plans — Visual Planning for Codex, Claude Code & Coding Agents",
      },
      {
        name: "description",
        content:
          "Give your coding agent a visual plan surface. Wireframes, diagrams, annotated code, prototypes, and shareable review links — installed in seconds as a skill for Codex, Claude Code, and any coding agent.",
      },
      {
        property: "og:title",
        content:
          "Agent-Native Plans — Visual Planning for Codex, Claude Code & Coding Agents",
      },
      {
        property: "og:description",
        content:
          "Give your coding agent a visual plan surface. Wireframes, diagrams, annotated code, and shareable review links.",
      },
      {
        name: "keywords",
        content:
          "AI coding agent plans, visual planning, Codex visual plan, Claude Code plans, coding agent wireframe, agent plan skill, visual plan mode, AI diagram generator, agent-native plans, annotated code review, shareable agent plans",
      },
    ],
    "Plans",
  );

const template = templates.find((t) => t.slug === "plan")!;

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

export default function PlanTemplate() {
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
              {t("templateDetail.badge", { name: template.name })}
            </div>

            <h1 className="mb-4 text-[2rem] font-bold leading-[1.08] tracking-tight sm:text-4xl md:text-5xl">
              {t("templateLanding.plan.s015")}
            </h1>

            <p className="mb-6 text-base leading-7 text-[var(--fg-secondary)] sm:text-lg sm:leading-relaxed">
              {t("templateLanding.plan.s016")}
            </p>

            <div className="template-detail-actions mb-8 grid grid-cols-2 items-stretch gap-3 sm:flex sm:flex-wrap sm:items-center">
              <a
                href="https://plan.agent-native.com"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-full bg-black px-6 py-3 text-sm font-medium text-white no-underline transition hover:bg-gray-800 hover:no-underline dark:bg-white dark:text-black dark:hover:bg-gray-200"
                onClick={() =>
                  trackEvent("try live demo", {
                    template: "plan",
                    location: "landing_page",
                  })
                }
              >
                {t("templateLanding.plan.s017")}
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
              alt={t("templateLanding.plan.s001")}
              className="w-full object-cover object-top"
            />
          </div>
        </div>
      </section>

      {/* By the numbers */}
      <section className="border-t border-[var(--docs-border)] py-16">
        <div className="mx-auto grid max-w-3xl gap-px overflow-hidden rounded-xl border border-[var(--docs-border)] bg-[var(--docs-border)] sm:grid-cols-4">
          {[
            { number: "10+", label: t("templateLanding.plan.s002") },
            { number: "3", label: t("templateLanding.plan.s003") },
            { number: "Live", label: t("templateLanding.plan.s004") },
            { number: "AI", label: t("templateLanding.plan.s005") },
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
          {t("templateLanding.plan.s018")}
        </h2>
        <p className="mb-8 max-w-2xl text-base text-[var(--fg-secondary)]">
          {t("templateLanding.plan.s019")}
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
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <rect x="7" y="7" width="3" height="9" />
                <rect x="14" y="7" width="3" height="5" />
              </svg>
            </div>
            <h3 className="mb-1 text-sm font-semibold">
              {t("templateLanding.plan.s020")}
            </h3>
            <p className="m-0 text-sm text-[var(--fg-secondary)]">
              {t("templateLanding.plan.s021")}
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
                <circle cx="12" cy="5" r="2" />
                <circle cx="5" cy="19" r="2" />
                <circle cx="19" cy="19" r="2" />
                <line x1="12" y1="7" x2="5" y2="17" />
                <line x1="12" y1="7" x2="19" y2="17" />
              </svg>
            </div>
            <h3 className="mb-1 text-sm font-semibold">
              {t("templateLanding.plan.s022")}
            </h3>
            <p className="m-0 text-sm text-[var(--fg-secondary)]">
              {t("templateLanding.plan.s023")}
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
                <polyline points="16 18 22 12 16 6" />
                <polyline points="8 6 2 12 8 18" />
                <line x1="12" y1="4" x2="12" y2="20" strokeDasharray="2 2" />
              </svg>
            </div>
            <h3 className="mb-1 text-sm font-semibold">
              {t("templateLanding.plan.s024")}
            </h3>
            <p className="m-0 text-sm text-[var(--fg-secondary)]">
              {t("templateLanding.plan.s025")}
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
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
              </svg>
            </div>
            <h3 className="mb-1 text-sm font-semibold">
              {t("templateLanding.plan.s026")}
            </h3>
            <p className="m-0 text-sm text-[var(--fg-secondary)]">
              {t("templateLanding.plan.s027")}
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
                <path d="M4 4h6l2 3h8v13H4z" />
                <path d="M8 13h8" />
                <path d="M12 9v8" />
              </svg>
            </div>
            <h3 className="mb-1 text-sm font-semibold">
              {t("templateLanding.plan.s028")}
            </h3>
            <p className="m-0 text-sm text-[var(--fg-secondary)]">
              {t("templateLanding.plan.s029")}
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
                <rect x="3" y="4" width="18" height="14" rx="2" />
                <path d="M8 21h8" />
                <path d="M12 18v3" />
                <path d="M9 9l-3 2.5L9 14" />
                <path d="M15 9l3 2.5L15 14" />
              </svg>
            </div>
            <h3 className="mb-1 text-sm font-semibold">
              {t("templateLanding.plan.s061")}
            </h3>
            <p className="m-0 text-sm text-[var(--fg-secondary)]">
              {t("templateLanding.plan.s062")}{" "}
              <a
                href="https://marketplace.visualstudio.com/items?itemName=Builder.agent-native"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[var(--fg)] underline underline-offset-2"
              >
                {t("templateLanding.plan.s063")}
              </a>
              {t("templateLanding.plan.s030")}
            </p>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="border-t border-[var(--docs-border)] py-16">
        <h2 className="mb-3 text-2xl font-bold tracking-tight">
          {t("templateLanding.plan.s031")}
        </h2>
        <p className="mb-10 max-w-2xl text-base text-[var(--fg-secondary)]">
          {t("templateLanding.plan.s032")}
        </p>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {[
            {
              step: "1",
              title: t("templateLanding.plan.s006"),
              body: t("templateLanding.plan.s007"),
            },
            {
              step: "2",
              title: t("templateLanding.plan.s008"),
              body: t("templateLanding.plan.s009"),
            },
            {
              step: "3",
              title: t("templateLanding.plan.s010"),
              body: t("templateLanding.plan.s011"),
            },
            {
              step: "4",
              title: t("templateLanding.plan.s012"),
              body: t("templateLanding.plan.s013"),
            },
          ].map((item) => (
            <div key={item.step} className="flex gap-4">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--bg-secondary)] text-sm font-bold text-[var(--docs-accent)] ring-1 ring-[var(--docs-border)]">
                {item.step}
              </div>
              <div>
                <h3 className="mb-1 text-sm font-semibold">{item.title}</h3>
                <p className="m-0 text-sm text-[var(--fg-secondary)]">
                  {item.body}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Block types deep-dive */}
      <section className="border-t border-[var(--docs-border)] py-16">
        <div className="grid gap-8 lg:grid-cols-2 lg:items-center">
          <div>
            <h2 className="mb-3 text-2xl font-bold tracking-tight">
              {t("templateLanding.plan.s033")}
            </h2>
            <p className="mb-6 text-base text-[var(--fg-secondary)]">
              {t("templateLanding.plan.s034")}
            </p>
            <ul className="m-0 list-none space-y-3 p-0 text-sm text-[var(--fg-secondary)]">
              {[
                "s064",
                "s065",
                "s066",
                "s067",
                "s068",
                "s069",
                "s070",
                "s071",
              ].map((key) => (
                <li key={key} className="flex items-start gap-2">
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
                  {t(`templateLanding.plan.${key}`)}
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-xl border border-[var(--docs-border)] bg-[var(--bg-secondary)] p-6">
            <div className="space-y-3 font-mono text-sm">
              <div className="text-[var(--fg-secondary)]">
                {t("templateLanding.plan.s072")}
              </div>
              <div>
                <span className="text-[var(--docs-accent)]">type:</span>{" "}
                <span className="text-[var(--fg)]">
                  {t("templateLanding.plan.s035")}
                </span>
              </div>
              <div>
                <span className="text-[var(--docs-accent)]">file:</span>{" "}
                <span className="text-[var(--fg)]">
                  src/actions/create-post.ts
                </span>
              </div>
              <div>
                <span className="text-[var(--docs-accent)]">annotations:</span>
              </div>
              <div className="pl-4">
                <span className="text-[var(--docs-accent)]">line 12:</span>{" "}
                <span className="text-[var(--fg)]">
                  {t("templateLanding.plan.s036")}
                </span>
              </div>
              <div className="pl-4">
                <span className="text-[var(--docs-accent)]">line 24:</span>{" "}
                <span className="text-[var(--fg)]">
                  {t("templateLanding.plan.s037")}
                </span>
              </div>
              <div>
                <span className="text-[var(--docs-accent)]">change:</span>{" "}
                <span className="text-[var(--fg)]">
                  {t("templateLanding.plan.s038")}
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Comparison table */}
      <section className="border-t border-[var(--docs-border)] py-16">
        <h2 className="mb-8 text-2xl font-bold tracking-tight">
          {t("templateLanding.plan.s039")}
        </h2>
        <div className="overflow-x-auto rounded-xl border border-[var(--docs-border)]">
          <table className="comparison-table min-w-[42rem] w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--docs-border)] bg-[var(--bg-secondary)]">
                <th className="px-5 py-3 text-left font-semibold text-[var(--fg)]"></th>
                <th className="px-5 py-3 text-left font-semibold text-[var(--fg-secondary)]">
                  {t("templateLanding.plan.s040")}
                </th>
                <th className="px-5 py-3 text-left font-semibold text-[var(--fg-secondary)]">
                  {t("templateLanding.plan.s073")}
                </th>
                <th className="px-5 py-3 text-left font-semibold text-[var(--docs-accent)]">
                  Agent-Native Plans
                </th>
              </tr>
            </thead>
            <tbody className="text-[var(--fg-secondary)]">
              <tr className="border-b border-[var(--docs-border)]">
                <td className="px-5 py-3 font-medium text-[var(--fg)]">
                  {t("templateLanding.plan.s041")}
                </td>
                <td className="px-5 py-3">{t("templateLanding.plan.s042")}</td>
                <td className="px-5 py-3">{t("templateLanding.plan.s043")}</td>
                <td className="px-5 py-3 text-[var(--fg)]">
                  {t("templateLanding.plan.s044")}
                </td>
              </tr>
              <tr className="border-b border-[var(--docs-border)]">
                <td className="px-5 py-3 font-medium text-[var(--fg)]">
                  {t("templateLanding.plan.s045")}
                </td>
                <td className="px-5 py-3">{t("templateLanding.plan.s046")}</td>
                <td className="px-5 py-3">{t("templateLanding.plan.s047")}</td>
                <td className="px-5 py-3 text-[var(--fg)]">
                  {t("templateLanding.plan.s048")}
                </td>
              </tr>
              <tr className="border-b border-[var(--docs-border)]">
                <td className="px-5 py-3 font-medium text-[var(--fg)]">
                  {t("templateLanding.plan.s049")}
                </td>
                <td className="px-5 py-3">{t("templateLanding.plan.s042")}</td>
                <td className="px-5 py-3">{t("templateLanding.plan.s050")}</td>
                <td className="px-5 py-3 text-[var(--fg)]">
                  {t("templateLanding.plan.s051")}
                </td>
              </tr>
              <tr className="border-b border-[var(--docs-border)]">
                <td className="px-5 py-3 font-medium text-[var(--fg)]">
                  {t("templateLanding.plan.s005")}
                </td>
                <td className="px-5 py-3">{t("templateLanding.plan.s042")}</td>
                <td className="px-5 py-3">{t("templateLanding.plan.s042")}</td>
                <td className="px-5 py-3 text-[var(--fg)]">
                  {t("templateLanding.plan.s052")}
                </td>
              </tr>
              <tr className="border-b border-[var(--docs-border)]">
                <td className="px-5 py-3 font-medium text-[var(--fg)]">
                  {t("templateLanding.plan.s053")}
                </td>
                <td className="px-5 py-3">{t("templateLanding.plan.s050")}</td>
                <td className="px-5 py-3">{t("templateLanding.plan.s042")}</td>
                <td className="px-5 py-3 text-[var(--fg)]">
                  {t("templateLanding.plan.s054")}
                </td>
              </tr>
              <tr>
                <td className="px-5 py-3 font-medium text-[var(--fg)]">
                  {t("templateLanding.plan.s055")}
                </td>
                <td className="px-5 py-3">{t("templateLanding.plan.s074")}</td>
                <td className="px-5 py-3">{t("templateLanding.plan.s042")}</td>
                <td className="px-5 py-3 text-[var(--fg)]">
                  {t("templateLanding.plan.s056")}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-[var(--docs-border)] py-16 text-center">
        <h2 className="mb-3 text-2xl font-bold tracking-tight">
          {t("templateLanding.plan.s057")}
        </h2>
        <p className="mx-auto mb-8 max-w-lg text-base text-[var(--fg-secondary)]">
          {t("templateLanding.plan.s058")}
        </p>
        <div className="template-detail-cta-actions flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center sm:gap-4">
          <TemplateDocsLink
            template={template}
            location="landing_page_cta"
            className="inline-flex items-center gap-2 rounded-full bg-black px-6 py-3 text-sm font-medium text-white no-underline transition hover:bg-gray-800 hover:no-underline dark:bg-white dark:text-black dark:hover:bg-gray-200"
          >
            {t("templateLanding.plan.s059")}
          </TemplateDocsLink>
          <Link
            data-an-prefetch="render"
            to="/templates"
            className="inline-flex items-center gap-2 rounded-full border border-[var(--docs-border)] px-6 py-3 text-sm font-medium text-[var(--fg)] no-underline transition hover:border-[var(--fg-secondary)] hover:no-underline"
          >
            {t("templateLanding.plan.s060")}
          </Link>
        </div>
      </section>
    </main>
  );
}
