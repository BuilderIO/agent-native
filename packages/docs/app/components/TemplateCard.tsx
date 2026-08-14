import { trackEvent } from "@agent-native/core/client/analytics";
import { useLocale, useT } from "@agent-native/core/client/i18n";
import { useState } from "react";
import { Link } from "react-router";

import { BuilderWaitlistContent } from "./BuilderWaitlistPopover";
import { sitePathForLocale } from "./docs-locale";
import { applyFirstTouchAttributionToLink } from "./marketing-attribution";
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
    color: "#52525B",
    screenshot:
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2Fefc6a3ac908149fa92e2b9392c0bb372?format=webp&width=800",
  },
  {
    name: "Design",
    slug: "design",
    cliCommand:
      "npx @agent-native/core@latest create my-design-app --template design",
    demoUrl: "https://design.agent-native.com",
    color: "#F472B6",
    screenshot:
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2Fe2c86908c2fa4f119ee4aa90b4823944?format=webp&width=800",
  },
  {
    name: "Content",
    slug: "content",
    cliCommand:
      "npx @agent-native/core@latest create my-content-app --template content",
    demoUrl: "https://content.agent-native.com",
    color: "#7928ca",
    screenshot:
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F89bcfc6106304bfbaf8ec8a7ccd721eb?format=webp&width=800",
  },
  {
    name: "Slides",
    slug: "slides",
    cliCommand:
      "npx @agent-native/core@latest create my-slides-app --template slides",
    demoUrl: "https://slides.agent-native.com",
    color: "#f59e0b",
    screenshot:
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F2c09b451d40c4a74a89a38d69170c2d8?format=webp&width=800",
  },
  {
    name: "Analytics",
    slug: "analytics",
    cliCommand:
      "npx @agent-native/core@latest create my-analytics-app --template analytics",
    demoUrl: "https://analytics.agent-native.com",
    color: "var(--docs-accent)",
    screenshot:
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F4933a80cc3134d7e874631f688be828a?format=webp&width=800",
  },
  {
    name: "Mail",
    slug: "mail",
    cliCommand:
      "npx @agent-native/core@latest create my-mail-app --template mail",
    demoUrl: "https://mail.agent-native.com",
    color: "#0ea5e9",
    screenshot:
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F6f49a81c404d4242b33317491eac7575?format=webp&width=800",
  },
  {
    name: "Forms",
    slug: "forms",
    cliCommand:
      "npx @agent-native/core@latest create my-forms-app --template forms",
    demoUrl: "https://forms.agent-native.com",
    color: "#06B6D4",
    screenshot:
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F190c3fabd51f4c1bba5aa4e091ad4e9b?format=webp&width=800",
  },
  {
    name: "Brain",
    slug: "brain",
    cliCommand:
      "npx @agent-native/core@latest create my-brain-app --template brain",
    demoUrl: "https://brain.agent-native.com",
    color: "#8B5CF6",
    screenshot:
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F9c9fe3b5b9494e33803cd3f494cba356?format=webp&width=800",
  },
  {
    name: "Assets",
    slug: "assets",
    cliCommand:
      "npx @agent-native/core@latest create my-assets-app --template assets",
    demoUrl: "https://assets.agent-native.com",
    color: "#0F766E",
    screenshot:
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F769092170a14474f998cbca47384f891?format=webp&width=800",
  },
  {
    name: "Calendar",
    slug: "calendar",
    cliCommand:
      "npx @agent-native/core@latest create my-calendar-app --template calendar",
    demoUrl: "https://calendar.agent-native.com",
    color: "#10b981",
    screenshot:
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2Ffb6c3b483ca24ab3b6c3a758aeceef4c?format=webp&width=800",
  },
  {
    name: "Dispatch",
    slug: "dispatch",
    cliCommand:
      "npx @agent-native/core@latest create my-dispatch-app --template dispatch",
    demoUrl: "https://dispatch.agent-native.com",
    color: "#14B8A6",
    screenshot:
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F104b3ad8d1dc461aa33ab9bff37a4482?format=webp&width=800",
  },
  {
    name: "Chat",
    slug: "chat",
    cliCommand:
      "npx @agent-native/core@latest create my-chat-app --template chat",
    demoUrl: "https://chat.agent-native.com",
    color: "#18181B",
    screenshot:
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F6b36dc596fca4799815fa34c31e1c406",
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
  const { locale } = useLocale();
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
      <Link
        data-an-prefetch="viewport"
        to={sitePathForLocale(`/apps/${template.slug}`, locale)}
        className="primary-button w-full"
        onClick={() =>
          trackEvent("click template", {
            template: template.slug,
            location: "card",
          })
        }
      >
        Learn more
      </Link>
      <div className="flex gap-2">
        {hasDemoUrl ? (
          <a
            href={`${template.demoUrl}/_agent-native/sign-in`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(event) => {
              applyFirstTouchAttributionToLink(event.currentTarget);
              trackEvent("click sign in", {
                template: template.slug,
                location: "card",
              });
            }}
            className="secondary-button flex-1"
          >
            {t("common.signIn")}
          </a>
        ) : null}
        <Popover open={showCustomize} onOpenChange={handleCustomizeOpenChange}>
          <PopoverTrigger asChild>
            <button type="button" className="secondary-button flex-1">
              Customize it
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
            src={template.screenshot}
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
