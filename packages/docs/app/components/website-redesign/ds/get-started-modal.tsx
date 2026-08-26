import { trackEvent } from "@agent-native/core/client/analytics";
import { IconX } from "@tabler/icons-react";
import type { MouseEvent, ReactNode } from "react";
import { useState } from "react";

import { BuildOnlinePopover } from "../../BuilderWaitlistPopover";
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
// instead of being swallowed by the modal.
const CTA_FALLBACK_HREF = "/apps";

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

function Option({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-[var(--spacing-3)] rounded-[var(--b-radius)] border border-solid border-[var(--b-border-default)] bg-[var(--b-bg-raised)] p-[var(--spacing-4)]">
      <p className="m-0 font-[family-name:var(--b-font-mono)] text-[12px] font-semibold tracking-[0.02em] text-[var(--b-text-secondary)] uppercase">
        {label}
      </p>
      {children}
    </div>
  );
}

export function GetStartedCta({
  location,
  children,
}: {
  location: GetStartedLocation;
  children: ReactNode;
}) {
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
        href={CTA_FALLBACK_HREF}
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
              Get started
            </DialogTitle>
            <DialogClose
              aria-label="Close"
              className="inline-flex cursor-pointer border-none bg-transparent text-[var(--b-text-secondary)] transition-[color] duration-150 ease-[ease] hover:text-[var(--b-text-primary)]"
            >
              <IconX size={18} stroke={1.5} />
            </DialogClose>
          </div>

          <Option label="Build an app locally">
            <InstallCommand />
            <Button
              variant="secondary"
              icon={null}
              href="/docs"
              onClick={() => choose("read_docs")}
            >
              Read the docs
            </Button>
          </Option>

          <Option label="Try an app">
            <Button
              variant="secondary"
              icon={null}
              href="/apps"
              onClick={() => choose("browse_apps")}
            >
              Browse apps
            </Button>
          </Option>

          {/* BuildOnlinePopover fires its own "click build online" event, so
              there is nothing to wrap here. */}
          <Option label="Build in the cloud">
            <BuildOnlinePopover location="get_started_modal" />
          </Option>
        </DialogContent>
      </Dialog>
    </>
  );
}
