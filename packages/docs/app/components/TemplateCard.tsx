import { trackEvent } from "@agent-native/core/client/analytics";
import { useLocale, useT } from "@agent-native/core/client/i18n";
import { Link } from "react-router";

import { BuilderImage } from "./builder-image";
import { sitePathForLocale } from "./docs-locale";
import { APP_ART } from "./website-redesign/app-art";
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
    screenshot:
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2Fab7beeb1f62548fab6e2a710d880a20c?format=webp&width=800",
  },
  {
    name: "Plans",
    slug: "plan",
    cliCommand: "npx @agent-native/core@latest skills add visual-plan",
    demoUrl: "https://plan.agent-native.com",
    color: "#2F6FED",
    screenshot:
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2Fc56ca318901149dbb0cdadea94946c11",
  },
  {
    name: "Design",
    slug: "design",
    cliCommand:
      "npx @agent-native/core@latest create my-design-app --template design",
    demoUrl: "https://design.agent-native.com",
    color: "#F472B6",
    screenshot:
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F75026532fe204acbab72d41dbeb34305?format=webp&width=800&height=1200",
  },
  {
    name: "Content",
    slug: "content",
    cliCommand:
      "npx @agent-native/core@latest create my-content-app --template content",
    demoUrl: "https://content.agent-native.com",
    color: "#7928ca",
    screenshot:
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2Fa70f7bcdb3744d8291eb607bfda36ab0",
  },
  {
    name: "Slides",
    slug: "slides",
    cliCommand:
      "npx @agent-native/core@latest create my-slides-app --template slides",
    demoUrl: "https://slides.agent-native.com",
    color: "#f59e0b",
    screenshot:
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F4b196d8d24c44914a021d1577f10879b",
  },
  {
    name: "Analytics",
    slug: "analytics",
    cliCommand:
      "npx @agent-native/core@latest create my-analytics-app --template analytics",
    demoUrl: "https://analytics.agent-native.com",
    color: "var(--docs-accent)",
    screenshot:
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2Fcf9102c2aa3b4de982a50ab88d07b6df",
  },
  {
    name: "Mail",
    slug: "mail",
    cliCommand:
      "npx @agent-native/core@latest create my-mail-app --template mail",
    demoUrl: "https://mail.agent-native.com",
    color: "#0ea5e9",
    screenshot:
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F84818cf9e2fa448b84fb9f91b6f1f80b",
  },
  {
    name: "Forms",
    slug: "forms",
    cliCommand:
      "npx @agent-native/core@latest create my-forms-app --template forms",
    demoUrl: "https://forms.agent-native.com",
    color: "#06B6D4",
    screenshot:
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2Fdae3c94347a248e385ab9981ec7921ac",
  },
  {
    name: "Assets",
    slug: "assets",
    cliCommand:
      "npx @agent-native/core@latest create my-assets-app --template assets",
    demoUrl: "https://assets.agent-native.com",
    color: "#0F766E",
    screenshot:
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F9fdd5469051f421db5f1fdcc749de66b?format=webp&width=800&height=1200",
  },
  {
    name: "Calendar",
    slug: "calendar",
    cliCommand:
      "npx @agent-native/core@latest create my-calendar-app --template calendar",
    demoUrl: "https://calendar.agent-native.com",
    color: "#10b981",
    screenshot:
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2Fd43810da66d44bfc96b21255b93d4ccb",
  },
  {
    name: "Dispatch",
    slug: "dispatch",
    cliCommand:
      "npx @agent-native/core@latest create my-dispatch-app --template dispatch",
    demoUrl: "https://dispatch.agent-native.com",
    color: "#14B8A6",
    screenshot:
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2Fea3f73fdf23240009ef0be82f7edc0fb",
  },
  {
    name: "Chat",
    slug: "chat",
    cliCommand:
      "npx @agent-native/core@latest create my-chat-app --template chat",
    demoUrl: "https://chat.agent-native.com",
    color: "#18181B",
    screenshot:
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F65323b4e4425484ab680ae3c158fd63d",
  },
  // ── DO NOT add new templates here directly. ──
  // The public-facing template list is the strict allow-list defined in
  // `packages/shared-app-config/templates.ts` (the entries with
  // `hidden: false`). To surface a new template on the homepage, first flip
  // its `hidden` flag in that file. The CI guard `scripts/guard-template-list.mjs`
  // enforces this -- adding a slug here that isn't in the allow-list will fail
  // the build.
];

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
  "chat",
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
      ? {
          replaces: t("templateLanding.clips.s007"),
          description: t("templateLanding.clips.s008"),
        }
      : template.slug === "slides"
        ? {
            replaces: [
              t("templateLanding.slides.s006Primary"),
              t("templateLanding.slides.s006Secondary"),
            ].join(" "),
            description: t("templateLanding.slides.s007"),
          }
        : null;
  const replaces =
    heroCopy?.replaces ?? t(`templates.${template.slug}.replaces`);
  const description =
    heroCopy?.description ?? t(`templates.${template.slug}.description`);
  const art = APP_ART[template.slug];

  return (
    <article className="group flex min-w-0 flex-col overflow-hidden border border-solid border-[var(--b-border-subtle)] bg-[var(--b-bg-page)] transition-[background-color] duration-150 ease-[ease] hover:bg-[var(--b-bg-raised)]">
      <Link
        data-an-prefetch="viewport"
        to={templatePath}
        className="flex flex-auto flex-col no-underline"
        onClick={() =>
          trackEvent("click template", {
            template: template.slug,
            location: "card",
          })
        }
      >
        <div className="relative flex aspect-[320/256] items-center justify-center overflow-hidden border-b border-solid border-[var(--b-border-subtle)] bg-[var(--b-bg-page)]">
          {art ? (
            <>
              <BuilderImage
                src={art.imageDark}
                crossOrigin="anonymous"
                alt={t("templateCard.screenshotAlt", { name: template.name })}
                loading="lazy"
                decoding="async"
                className="theme-img-dark relative h-full w-full object-cover"
              />
              <BuilderImage
                src={art.imageLight}
                crossOrigin="anonymous"
                alt={t("templateCard.screenshotAlt", { name: template.name })}
                loading="lazy"
                decoding="async"
                className="theme-img-light absolute inset-0 h-full w-full object-cover"
              />
              {/* Decorative on purpose: the illustration beneath already carries
                the alt text, and both layers stay mounted so the reveal is a
                CSS fade rather than a swapped src. */}
              {art.hoverImage ? (
                <BuilderImage
                  src={art.hoverImage}
                  crossOrigin="anonymous"
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="absolute inset-0 h-full w-full object-cover opacity-0 transition-opacity duration-300 group-hover:opacity-100"
                />
              ) : null}
            </>
          ) : template.screenshot ? (
            <BuilderImage
              src={template.screenshot}
              crossOrigin="anonymous"
              alt={t("templateCard.screenshotAlt", { name: template.name })}
              loading="lazy"
              decoding="async"
              className="h-full w-full object-cover object-top transition-opacity hover:opacity-90"
            />
          ) : (
            <div
              className="flex h-full w-full items-center justify-center"
              style={{
                background: `linear-gradient(135deg, ${template.color}, ${template.color}22)`,
              }}
            >
              <span className="rounded-lg bg-[var(--b-bg-page)]/80 px-4 py-2 font-[family-name:var(--b-font-sans)] text-sm font-semibold text-[var(--b-text-primary)] shadow-sm">
                {template.name}
              </span>
            </div>
          )}
        </div>
        <div className="flex flex-auto flex-col items-start gap-[var(--spacing-3)] p-[var(--spacing-5)]">
          <h3 className="m-0 font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-heading-5)] font-medium leading-[1.15] tracking-[-0.02em] text-[var(--b-text-primary)]">
            {template.name}
          </h3>
          <p className="m-0 font-[family-name:var(--b-font-mono)] text-[length:var(--b-t-label-2)] uppercase tracking-[0.04em] text-[var(--b-text-muted)]">
            {replaces}
          </p>
          <p className="m-0 font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-paragraph-2)] leading-[1.4] text-[var(--b-text-secondary)]">
            {description}
          </p>
          <CardArrow />
        </div>
      </Link>
    </article>
  );
}
