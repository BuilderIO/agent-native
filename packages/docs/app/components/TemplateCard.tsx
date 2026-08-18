import { trackEvent } from "@agent-native/core/client/analytics";
import { useLocale, useT } from "@agent-native/core/client/i18n";
import { useState } from "react";
import { Link } from "react-router";

import { BuilderWaitlistContent } from "./BuilderWaitlistPopover";
import { sitePathForLocale } from "./docs-locale";
import { applyFirstTouchAttributionToLink } from "./marketing-attribution";
import { TemplateDocsLink } from "./template-docs";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";

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
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F775bae8e78b34d309bd3b9be5d7137e8?format=webp&width=800&height=1200",
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
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F9fb501f3ab2145e78ab4a8b5b80bb793?format=webp&width=800&height=1200",
  },
  {
    name: "Slides",
    slug: "slides",
    cliCommand:
      "npx @agent-native/core@latest create my-slides-app --template slides",
    demoUrl: "https://slides.agent-native.com",
    color: "#f59e0b",
    screenshot:
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2Ffccd0f339b764a6cbbf5308d0045112d?format=webp&width=800&height=1200",
  },
  {
    name: "Analytics",
    slug: "analytics",
    cliCommand:
      "npx @agent-native/core@latest create my-analytics-app --template analytics",
    demoUrl: "https://analytics.agent-native.com",
    color: "var(--docs-accent)",
    screenshot:
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F4272c4c3fb924206bae05141ed8f324b?format=webp&width=800&height=1200",
  },
  {
    name: "Mail",
    slug: "mail",
    cliCommand:
      "npx @agent-native/core@latest create my-mail-app --template mail",
    demoUrl: "https://mail.agent-native.com",
    color: "#0ea5e9",
    screenshot:
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F996f57a8e1ce4570b9fefd57df56cc4c?format=webp&width=800&height=1200",
  },
  {
    name: "Forms",
    slug: "forms",
    cliCommand:
      "npx @agent-native/core@latest create my-forms-app --template forms",
    demoUrl: "https://forms.agent-native.com",
    color: "#06B6D4",
    screenshot:
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F46975a73af5246b39a23e6c4c1361516?format=webp&width=800&height=1200",
  },
  {
    name: "Brain",
    slug: "brain",
    cliCommand:
      "npx @agent-native/core@latest create my-brain-app --template brain",
    demoUrl: "https://brain.agent-native.com",
    color: "#8B5CF6",
    screenshot:
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F8cc4d4e2d39d4781bd4dd86d449d88e7?format=webp&width=800&height=1200",
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
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F7847155fdcf14f559d34752c11f311b9?format=webp&width=800&height=1200",
  },
  {
    name: "Dispatch",
    slug: "dispatch",
    cliCommand:
      "npx @agent-native/core@latest create my-dispatch-app --template dispatch",
    demoUrl: "https://dispatch.agent-native.com",
    color: "#14B8A6",
    screenshot:
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2Fdf5c35aec8924134a9b9bbc9d8cec9e8?format=webp&width=800&height=1200",
  },
  {
    name: "Chat",
    slug: "chat",
    cliCommand:
      "npx @agent-native/core@latest create my-chat-app --template chat",
    demoUrl: "https://chat.agent-native.com",
    color: "#18181B",
    screenshot:
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F0341ba536725449587831a33bde6f489?format=webp&width=800&height=1200",
  },
  // ── DO NOT add new templates here directly. ──
  // The public-facing template list is the strict allow-list defined in
  // `packages/shared-app-config/templates.ts` (the entries with
  // `hidden: false`). To surface
  // a new template on the homepage, first flip its `hidden` flag in that
  // file. The CI guard
  // `scripts/guard-template-list.mjs` enforces this — adding a slug here
  // that isn't in the allow-list will fail the build.
];

export type Template = (typeof templates)[number];

export const featuredTemplates = [
  "clips",
  "plan",
  "design",
  "slides",
  "analytics",
  "assets",
  "content",
  "chat",
  "dispatch",
  "brain",
  "calendar",
  "mail",
  "forms",
].map((slug) => templates.find((template) => template.slug === slug)!);

function CliPopoverContent({ template }: { template: Template }) {
  const [copied, setCopied] = useState(false);
  const { locale } = useLocale();
  const t = useT();

  function handleCopy() {
    navigator.clipboard.writeText(template.cliCommand);
    setCopied(true);
    trackEvent("copy cli command", {
      template: template.slug,
      location: "card",
    });
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <>
      <div className="flex min-w-0 items-center gap-2 px-3 py-2">
        <code className="block min-w-0 truncate text-xs leading-relaxed text-[var(--fg)]">
          {template.cliCommand}
        </code>
        <button
          onClick={handleCopy}
          className="shrink-0 rounded-md p-1 text-[var(--fg-secondary)] transition hover:text-[var(--fg)]"
          aria-label={t("common.copyCommand")}
        >
          {copied ? (
            <svg
              width="12"
              height="12"
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
              width="12"
              height="12"
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
        </button>
      </div>
      <div className="border-t border-[var(--code-border)] px-3 py-1.5 text-[10px] text-[var(--fg-secondary)]">
        {t("templateCard.pasteIntoTerminal")}{" "}
        <Link
          data-an-prefetch="viewport"
          to={sitePathForLocale("/docs/getting-started", locale)}
          className="text-[var(--docs-accent)] no-underline hover:underline"
        >
          {t("templateCard.newToCli")}
        </Link>
      </div>
    </>
  );
}

function TemplateLaunchButton({ template }: { template: Template }) {
  const [showCustomize, setShowCustomize] = useState(false);
  const [customizeMode, setCustomizeMode] = useState<
    "menu" | "editOnline" | "runLocally"
  >("menu");
  const t = useT();
  const hasDemoUrl = "demoUrl" in template && template.demoUrl;

  function handleCustomizeOpenChange(open: boolean) {
    if (open) {
      trackEvent("click customize it", {
        template: template.slug,
        location: "card",
      });
    } else {
      setCustomizeMode("menu");
    }
    setShowCustomize(open);
  }

  function showEditOnline() {
    trackEvent("click edit online", {
      template: template.slug,
      location: "card",
    });
    setCustomizeMode("editOnline");
  }

  function showRunLocally() {
    trackEvent("click run locally", {
      template: template.slug,
      location: "card",
    });
    setCustomizeMode("runLocally");
  }

  return (
    <div className="mt-auto flex flex-col gap-2 pt-3">
      {hasDemoUrl ? (
        <a
          href={template.demoUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(event) => {
            applyFirstTouchAttributionToLink(event.currentTarget);
            trackEvent("click try demo", {
              template: template.slug,
              location: "card",
            });
          }}
          className="primary-button template-card-primary-button w-full"
        >
          {t("common.tryIt")}
        </a>
      ) : null}
      <div className="flex gap-2">
        <Popover open={showCustomize} onOpenChange={handleCustomizeOpenChange}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="secondary-button flex-1 whitespace-nowrap"
            >
              {t("common.customizeIt")}
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            sideOffset={6}
            collisionPadding={16}
            className={
              customizeMode === "runLocally"
                ? "w-max max-w-[calc(100vw-32px)]"
                : customizeMode === "editOnline"
                  ? "w-[min(100vw-32px,360px)] p-4"
                  : "w-[min(100vw-32px,220px)] p-1"
            }
          >
            {customizeMode === "runLocally" ? (
              <CliPopoverContent template={template} />
            ) : customizeMode === "editOnline" ? (
              <BuilderWaitlistContent
                location="card"
                template={template.slug}
                source="docs_template_card"
                useCase="docs_edit_online_waitlist"
              />
            ) : (
              <div className="flex flex-col">
                <button
                  type="button"
                  onClick={showEditOnline}
                  className="rounded-md px-3 py-2 text-left text-sm font-medium text-[var(--fg)] transition hover:bg-[var(--bg-secondary)]"
                >
                  {t("common.editOnline")}
                </button>
                <button
                  type="button"
                  onClick={showRunLocally}
                  className="rounded-md px-3 py-2 text-left text-sm font-medium text-[var(--fg)] transition hover:bg-[var(--bg-secondary)]"
                >
                  {t("common.runLocally")}
                </button>
              </div>
            )}
          </PopoverContent>
        </Popover>
        <TemplateDocsLink
          template={template}
          location="card"
          className="secondary-button flex-1 whitespace-nowrap"
        />
      </div>
    </div>
  );
}

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
            replaces: t("templateLanding.slides.s006"),
            description: t("templateLanding.slides.s007"),
          }
        : null;
  const replaces =
    heroCopy?.replaces ?? t(`templates.${template.slug}.replaces`);
  const description =
    heroCopy?.description ?? t(`templates.${template.slug}.description`);

  return (
    <div className="feature-card flex flex-col gap-3 overflow-hidden">
      <Link
        data-an-prefetch="viewport"
        to={templatePath}
        className="-mx-[24px] -mt-[24px] mb-1 flex aspect-[924/729] items-center justify-center overflow-hidden border-b border-[var(--docs-border)] bg-[var(--bg-secondary)] transition hover:opacity-90"
        onClick={() =>
          trackEvent("click template", {
            template: template.slug,
            location: "card",
          })
        }
      >
        {template.screenshot ? (
          <img
            src={
              template.slug === "clips"
                ? "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2Febc2a7d837664382853cbfb481592b31?format=webp&width=800&height=1200"
                : template.screenshot
            }
            crossOrigin="anonymous"
            alt={t("templateCard.screenshotAlt", { name: template.name })}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover object-top"
          />
        ) : (
          <div
            className="flex h-full w-full items-center justify-center"
            style={{
              background: `linear-gradient(135deg, ${template.color}, ${template.color}22)`,
            }}
          >
            <span className="rounded-lg bg-[var(--bg)]/80 px-4 py-2 text-sm font-semibold text-[var(--fg)] shadow-sm">
              {template.name}
            </span>
          </div>
        )}
      </Link>
      <h3 className="text-base font-semibold">
        <Link
          data-an-prefetch="viewport"
          to={templatePath}
          className="text-[var(--fg)] no-underline hover:text-[var(--docs-accent)]"
        >
          {template.name}
        </Link>
      </h3>
      <p className="m-0 text-xs text-[var(--docs-accent)]">{replaces}</p>
      <p className="m-0 text-sm leading-relaxed text-[var(--fg-secondary)]">
        {description}
      </p>
      <TemplateLaunchButton template={template} />
    </div>
  );
}
