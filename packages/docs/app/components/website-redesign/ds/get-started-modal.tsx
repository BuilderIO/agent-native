import { trackEvent } from "@agent-native/core/client/analytics";
import { useLocale, useT } from "@agent-native/core/client/i18n";
import { IconX } from "@tabler/icons-react";
import type { MouseEvent, ReactNode } from "react";
import { useState } from "react";

import { BuildOnlinePopover } from "../../BuilderWaitlistPopover";
import { sitePathForLocale } from "../../docs-locale";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
} from "../../ui/dialog";
import { InstallCommand } from "../install-command";
import { Button } from "./button";

// The CTA is a real link first: it points at /apps so it still works with the
// JS bundle missing, and so Cmd/middle-click opens that page in a new tab
// instead of being swallowed by the modal. Locale-prefixed at render so the
// no-JS fallback keeps the visitor in their own route tree.
const CTA_FALLBACK_PATH = "/apps";

// Where the visitor started from, so the funnel can tell the hero CTA apart
// from the one at the bottom of the page.
export type GetStartedLocation = "hero" | "bottom_cta";

function shouldOpenInNewTab(event: MouseEvent) {
  return (
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey ||
    event.button !== 0
  );
}

function Option({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={[
        "flex flex-col items-center gap-[var(--spacing-3)] rounded-[var(--b-radius)] border border-solid border-[var(--b-border-default)] bg-[var(--b-bg-raised)] p-[var(--spacing-4)] text-center",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <p className="m-0 font-[family-name:var(--b-font-mono)] text-[12px] font-semibold tracking-[0.02em] text-[var(--b-text-secondary)] uppercase">
        {label}
      </p>
      {children}
    </div>
  );
}

export function GetStartedCta({
  location,
  className,
  children,
}: {
  location: GetStartedLocation;
  className?: string;
  children: ReactNode;
}) {
  const t = useT();
  const { locale } = useLocale();
  const localizedPath = (path: string) => sitePathForLocale(path, locale);
  const [open, setOpen] = useState(false);

  function handleTriggerClick(event: MouseEvent<HTMLAnchorElement>) {
    if (shouldOpenInNewTab(event)) return;
    event.preventDefault();
    trackEvent("click get started", { location });
    setOpen(true);
  }

  function choose(option: string) {
    trackEvent("choose get started path", { option, location });
  }

  return (
    <>
      <Button
        variant="cta"
        icon={null}
        href={localizedPath(CTA_FALLBACK_PATH)}
        className={className}
        onClick={handleTriggerClick}
      >
        {children}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          // The token variables are scoped to .builder-brand-tokens and this
          // content is portalled to <body>, outside that wrapper, so the scope
          // has to come along or every --b-* below resolves to nothing.
          className="builder-brand-tokens flex flex-col gap-[var(--spacing-5)] rounded-[var(--b-radius)] border border-solid border-[var(--b-border-default)] bg-[var(--b-bg-surface)] p-[var(--spacing-6)]"
        >
          <div className="flex items-center justify-between gap-[var(--spacing-4)]">
            <DialogTitle className="m-0 font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-heading-5)] font-medium tracking-[-0.02em] text-[var(--b-text-primary)]">
              {t("homepage.getStartedModal.title")}
            </DialogTitle>
            <DialogClose
              aria-label={t("homepage.getStartedModal.close")}
              className="inline-flex cursor-pointer border-none bg-transparent text-[var(--b-text-secondary)] transition-[color] duration-150 ease-[ease] hover:text-[var(--b-text-primary)]"
            >
              <IconX size={18} stroke={1.5} />
            </DialogClose>
          </div>

          {/* The local path spans the top row because it carries the install
              command, which is wider than half of the 520px dialog. One column
              on a narrow phone, where two would not fit the buttons. */}
          <div className="grid grid-cols-2 gap-[var(--spacing-3)] narrow:grid-cols-1">
            <Option
              label={t("homepage.getStartedModal.buildLocally")}
              className="col-span-2 narrow:col-span-1"
            >
              <InstallCommand />
              <Button
                variant="cta"
                icon={null}
                href={localizedPath("/docs")}
                className="uppercase"
                onClick={() => choose("read_docs")}
              >
                {t("common.readDocs")}
              </Button>
            </Option>

            <Option label={t("homepage.getStartedModal.tryAnApp")}>
              <Button
                variant="cta"
                icon={null}
                href={localizedPath("/apps")}
                className="uppercase"
                onClick={() => choose("browse_apps")}
              >
                {t("homepage.showcase.browseApps")}
              </Button>
            </Option>

            {/* BuildOnlinePopover fires its own "click build online" event, so
              there is nothing to wrap here. Its default trigger belongs to the
              older docs button vocabulary (full width, sans, rounded-md),
              which is why this one used to look nothing like the other two.
              The label stays on the catalog key because it is translated. */}
            <Option label={t("homepage.getStartedModal.buildInCloud")}>
              <BuildOnlinePopover
                location="get_started_modal"
                trigger={
                  <Button variant="cta" icon={null} className="uppercase">
                    {t("buildFromScratch.buildOnline")}
                  </Button>
                }
              />
            </Option>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
