import { trackEvent } from "@agent-native/core/client/analytics";
import { useLocale, useT } from "@agent-native/core/client/i18n";
import {
  IconArrowLeft,
  IconCheck,
  IconCode,
  IconCopy,
  IconWorld,
} from "@tabler/icons-react";
import { useState } from "react";
import { Link } from "react-router";

import { BuilderWaitlistContent } from "./BuilderWaitlistPopover";
import { sitePathForLocale } from "./docs-locale";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";

type CustomizableTemplate = {
  cliCommand: string;
  name: string;
  slug: string;
};

type CustomizeMode = "menu" | "online" | "local";

export function CustomizeTemplatePopover({
  template,
  location = "template_detail",
  className = "secondary-button whitespace-nowrap",
}: {
  template: CustomizableTemplate;
  location?: "card" | "template_detail";
  className?: string;
}) {
  const { locale } = useLocale();
  const t = useT();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<CustomizeMode>("menu");

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      trackEvent("click customize it", {
        template: template.slug,
        location,
      });
    } else {
      setMode("menu");
    }
    setOpen(nextOpen);
  }

  function selectMode(nextMode: Exclude<CustomizeMode, "menu">) {
    trackEvent(
      nextMode === "online"
        ? "click customize online"
        : "click customize locally",
      {
        template: template.slug,
        location,
      },
    );
    setMode(nextMode);
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button type="button" className={className}>
          {t("common.customizeIt")}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={8}
        collisionPadding={16}
        className={
          mode === "local"
            ? "w-max max-w-[calc(100vw-32px)]"
            : mode === "online"
              ? "w-[min(100vw-32px,360px)] p-4"
              : "w-[min(100vw-32px,280px)] p-4"
        }
      >
        {mode === "online" ? (
          <div>
            <button
              type="button"
              onClick={() => setMode("menu")}
              className="mb-3 inline-flex items-center gap-1 text-xs text-[var(--fg-secondary)] transition hover:text-[var(--fg)]"
            >
              <IconArrowLeft size={14} aria-hidden="true" />
              {t("common.customizeIt")}
            </button>
            <BuilderWaitlistContent
              location={location}
              template={template.slug}
              source="docs_template_customize"
              useCase="docs_edit_online_waitlist"
            />
          </div>
        ) : mode === "local" ? (
          <div className="min-w-0">
            <button
              type="button"
              onClick={() => setMode("menu")}
              className="mb-3 inline-flex items-center gap-1 text-xs text-[var(--fg-secondary)] transition hover:text-[var(--fg)]"
            >
              <IconArrowLeft size={14} aria-hidden="true" />
              {t("common.customizeIt")}
            </button>
            <div className="flex min-w-0 items-center gap-2 rounded-md border border-[var(--code-border)] bg-[var(--code-bg)] px-3 py-2">
              <IconCode
                size={14}
                className="shrink-0 text-[var(--fg-secondary)]"
                aria-hidden="true"
              />
              <code className="block min-w-0 truncate text-xs leading-relaxed text-[var(--fg)]">
                {template.cliCommand}
              </code>
              <CopyCommandButton template={template} />
            </div>
            <p className="mt-2 mb-0 text-[10px] text-[var(--fg-secondary)]">
              {t("templateCard.pasteIntoTerminal")}{" "}
              <Link
                data-an-prefetch="viewport"
                to={sitePathForLocale("/docs/getting-started", locale)}
                className="text-[var(--docs-accent)] no-underline hover:underline"
              >
                {t("templateCard.newToCli")}
              </Link>
            </p>
          </div>
        ) : (
          <div className="grid gap-3">
            <div>
              <p className="m-0 text-sm font-semibold text-[var(--fg)]">
                {t("common.customizeIt")}
              </p>
              <p className="mt-1 mb-0 text-xs leading-relaxed text-[var(--fg-secondary)]">
                {t("templatesPage.customizeDescription")}
              </p>
            </div>
            <div className="grid gap-1">
              <button
                type="button"
                onClick={() => selectMode("online")}
                className="flex items-center gap-2 rounded-md px-2 py-2 text-left text-sm font-medium text-[var(--fg)] transition hover:bg-[var(--bg-secondary)]"
              >
                <IconWorld size={16} aria-hidden="true" />
                {t("templatesPage.customizeOnline")}
                {/* Caps come from CSS, not the string: an all-caps label
                    becomes the accessible name and screen readers spell it out
                    letter by letter. */}
                <span className="ml-auto shrink-0 rounded border border-[var(--docs-border)] px-1.5 py-0.5 font-[family-name:var(--font-mono)] text-[10px] font-semibold uppercase tracking-[0.04em] text-[var(--fg-secondary)]">
                  {t("templatesPage.customizeOnlineBadge")}
                </span>
              </button>
              <button
                type="button"
                onClick={() => selectMode("local")}
                className="flex items-center gap-2 rounded-md px-2 py-2 text-left text-sm font-medium text-[var(--fg)] transition hover:bg-[var(--bg-secondary)]"
              >
                <IconCode size={16} aria-hidden="true" />
                {t("templatesPage.customizeLocally")}
              </button>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function CopyCommandButton({ template }: { template: CustomizableTemplate }) {
  const t = useT();
  const [copied, setCopied] = useState(false);

  async function copyCommand() {
    await navigator.clipboard.writeText(template.cliCommand);
    setCopied(true);
    trackEvent("copy cli command", {
      template: template.slug,
      location: "template_customize",
    });
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button
      type="button"
      onClick={() => void copyCommand()}
      className="shrink-0 rounded-md p-1 text-[var(--fg-secondary)] transition hover:bg-[var(--bg-secondary)] hover:text-[var(--fg)]"
      aria-label={t("common.copyCommand")}
    >
      {copied ? (
        <IconCheck size={14} aria-hidden="true" />
      ) : (
        <IconCopy size={14} aria-hidden="true" />
      )}
    </button>
  );
}
