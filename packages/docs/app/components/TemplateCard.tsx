import { trackEvent } from "@agent-native/core/client/analytics";
import { useLocale, useT } from "@agent-native/core/client/i18n";
import { Link } from "react-router";

import { sendAhrefsEvent } from "../lib/ahrefs-analytics";
import { sitePathForLocale } from "./docs-locale";
import {
  getScreenshotTileScaleX,
  TEMPLATE_SCREENSHOTS,
} from "./template-screenshots";
import { TemplateScreenshot } from "./TemplateScreenshot";
import { AppStatusBadge } from "./website-redesign/ds/app-status-badge";
import { CardArrow } from "./website-redesign/ds/card-arrow";

export { trackEvent };

export const templates = [
  {
    name: "Clips",
    slug: "clips",
    cliCommand:
      "npx @agent-native/core@latest create my-clips-app --template clips",
    demoUrl: "https://clips.agent-native.com",
    color: "#0EA5E9",
    screenshot: TEMPLATE_SCREENSHOTS.clips,
  },
  {
    name: "Plans",
    slug: "plan",
    cliCommand: "npx @agent-native/core@latest skills add visual-plan",
    demoUrl: "https://plan.agent-native.com",
    color: "#2F6FED",
    screenshot: TEMPLATE_SCREENSHOTS.plan,
  },
  {
    name: "Design",
    slug: "design",
    cliCommand:
      "npx @agent-native/core@latest create my-design-app --template design",
    demoUrl: "https://design.agent-native.com",
    color: "#F472B6",
    screenshot: TEMPLATE_SCREENSHOTS.design,
  },
  {
    name: "Content",
    slug: "content",
    cliCommand:
      "npx @agent-native/core@latest create my-content-app --template content",
    demoUrl: "https://content.agent-native.com",
    color: "#7928ca",
    screenshot: TEMPLATE_SCREENSHOTS.content,
  },
  {
    name: "Slides",
    slug: "slides",
    cliCommand:
      "npx @agent-native/core@latest create my-slides-app --template slides",
    demoUrl: "https://slides.agent-native.com",
    color: "#f59e0b",
    screenshot: TEMPLATE_SCREENSHOTS.slides,
  },
  {
    name: "Analytics",
    slug: "analytics",
    cliCommand:
      "npx @agent-native/core@latest create my-analytics-app --template analytics",
    demoUrl: "https://analytics.agent-native.com",
    color: "var(--docs-accent)",
    screenshot: TEMPLATE_SCREENSHOTS.analytics,
  },
  {
    name: "Mail",
    slug: "mail",
    cliCommand:
      "npx @agent-native/core@latest create my-mail-app --template mail",
    demoUrl: "https://mail.agent-native.com",
    color: "#0ea5e9",
    screenshot: TEMPLATE_SCREENSHOTS.mail,
  },
  {
    name: "Forms",
    slug: "forms",
    cliCommand:
      "npx @agent-native/core@latest create my-forms-app --template forms",
    demoUrl: "https://forms.agent-native.com",
    color: "#06B6D4",
    screenshot: TEMPLATE_SCREENSHOTS.forms,
  },
  {
    name: "Assets",
    slug: "assets",
    cliCommand:
      "npx @agent-native/core@latest create my-assets-app --template assets",
    demoUrl: "https://assets.agent-native.com",
    color: "#0F766E",
    screenshot: TEMPLATE_SCREENSHOTS.assets,
  },
  {
    name: "Calendar",
    slug: "calendar",
    cliCommand:
      "npx @agent-native/core@latest create my-calendar-app --template calendar",
    demoUrl: "https://calendar.agent-native.com",
    color: "#10b981",
    screenshot: TEMPLATE_SCREENSHOTS.calendar,
  },
  {
    name: "Dispatch",
    slug: "dispatch",
    cliCommand:
      "npx @agent-native/core@latest create my-dispatch-app --template dispatch",
    demoUrl: "https://dispatch.agent-native.com",
    color: "#14B8A6",
    screenshot: TEMPLATE_SCREENSHOTS.dispatch,
  },
  {
    name: "Chat",
    slug: "chat",
    cliCommand:
      "npx @agent-native/core@latest create my-chat-app --template chat",
    demoUrl: "https://chat.agent-native.com",
    color: "#18181B",
    screenshot: TEMPLATE_SCREENSHOTS.chat,
  },
  // ── DO NOT add new templates here directly. ──
  // The public-facing template list is the strict allow-list defined in
  // `packages/shared-app-config/templates.ts` (the entries with
  // `hidden: false`). To surface a new template on the homepage, first flip
  // its `hidden` flag in that file. The CI guard `scripts/guard-template-list.mjs`
  // enforces this -- adding a slug here that isn't in the allow-list will fail
  // the build.
] as const;

export type Template = (typeof templates)[number];

export const featuredTemplates = [
  "clips",
  "design",
  "slides",
  "analytics",
  "calendar",
  "mail",
  "assets",
  "content",
  "dispatch",
  "forms",
  "plan",
].map((slug) => templates.find((template) => template.slug === slug)!);

export function TemplateCard({ template }: { template: Template }) {
  const { locale } = useLocale();
  const t = useT();
  const templatePath = sitePathForLocale(`/apps/${template.slug}`, locale);
  const heroCopy =
    template.slug === "clips"
      ? { description: t("templateLanding.clips.s008") }
      : template.slug === "slides"
        ? { description: t("templateLanding.slides.s007") }
        : null;
  const description =
    heroCopy?.description ?? t(`templates.${template.slug}.description`);

  return (
    <article className="group flex min-w-0 flex-col overflow-hidden border-e border-b border-solid border-[var(--b-border-subtle)] bg-[var(--b-bg-page)] transition-[background-color] duration-150 ease-[ease] hover:bg-[var(--b-bg-raised)]">
      <Link
        data-an-prefetch="viewport"
        to={templatePath}
        className="flex flex-auto flex-col no-underline"
        onClick={() => {
          trackEvent("click template", {
            template: template.slug,
            location: "card",
          });
          sendAhrefsEvent("apps_card_click", { app: template.slug });
        }}
      >
        <div className="relative aspect-[8/5] overflow-hidden bg-[var(--b-bg-page)]">
          <TemplateScreenshot
            alt={t("templateCard.screenshotAlt", { name: template.name })}
            scaleX={getScreenshotTileScaleX(template.slug)}
            sizes="(max-width: 639px) 100vw, (max-width: 1023px) 50vw, 33vw"
            variants={TEMPLATE_SCREENSHOTS[template.slug]}
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-[var(--b-border-subtle)]"
          />
        </div>
        <div className="flex flex-auto flex-col items-start gap-[var(--spacing-3)] p-[var(--spacing-5)]">
          <h3 className="m-0 flex items-center gap-[var(--spacing-2)] font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-heading-5)] font-medium leading-[1.15] tracking-[-0.02em] text-[var(--b-text-primary)]">
            {template.name}
            <AppStatusBadge appId={template.slug} />
          </h3>
          <p className="m-0 font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-paragraph-2)] leading-[1.4] text-[var(--b-text-secondary)]">
            {description}
          </p>
          <CardArrow />
        </div>
      </Link>
    </article>
  );
}
