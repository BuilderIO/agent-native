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
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        gap: "var(--spacing-3)",
        padding: "var(--spacing-4)",
        border: "1px solid var(--b-border-default)",
        borderRadius: "var(--b-radius)",
        background: "var(--b-bg-raised)",
      }}
    >
      <p
        className="m-0 uppercase"
        style={{
          color: "var(--b-text-secondary)",
          fontFamily: "var(--b-font-mono)",
          fontSize: 12,
          fontWeight: 600,
          letterSpacing: "0.02em",
        }}
      >
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
          className="builder-brand-tokens"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--spacing-5)",
            padding: "var(--spacing-6)",
            border: "1px solid var(--b-border-default)",
            borderRadius: "var(--b-radius)",
            background: "var(--b-bg-surface)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "var(--spacing-4)",
            }}
          >
            <DialogTitle
              style={{
                margin: 0,
                fontFamily: "var(--b-font-sans)",
                fontSize: "var(--b-t-heading-5)",
                fontWeight: 500,
                letterSpacing: "-0.02em",
                color: "var(--b-text-primary)",
              }}
            >
              Get started
            </DialogTitle>
            <DialogClose
              aria-label="Close"
              className="hover:text-[var(--b-text-primary)]"
              style={{
                display: "inline-flex",
                background: "transparent",
                border: "none",
                color: "var(--b-text-secondary)",
                cursor: "pointer",
                transition: "color 0.15s",
              }}
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
