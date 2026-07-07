import { agentNativePath, useLocale, useT } from "@agent-native/core/client";
import * as Popover from "@radix-ui/react-popover";
import { IconLoader2 } from "@tabler/icons-react";
import { useCallback, useState } from "react";
import { Link } from "react-router";

import { sitePathForLocale } from "./docs-locale";
import { trackEvent } from "./TemplateCard";

const primaryButtonClassName =
  "inline-flex w-full items-center justify-center gap-2 rounded-lg bg-black px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-800 dark:bg-white dark:text-black dark:hover:bg-gray-200";

const secondaryButtonClassName =
  "inline-flex w-full items-center justify-center rounded-lg border border-[var(--docs-border)] px-4 py-2 text-sm font-medium text-[var(--fg)] no-underline transition hover:border-[var(--fg-secondary)] hover:no-underline";

function BuildOnlinePopover({
  location,
}: {
  location: "homepage_rail" | "templates_index";
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [joining, setJoining] = useState(false);
  const [joined, setJoined] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleJoinWaitlist = useCallback(async () => {
    const trimmed = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError(t("buildFromScratch.invalidEmail"));
      return;
    }

    setJoining(true);
    setError(null);
    try {
      const res = await fetch(
        agentNativePath("/_agent-native/builder/branch-waitlist"),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: trimmed,
            pageUrl: window.location.href,
            source: "docs_build_from_scratch",
            useCase: "docs_build_online_waitlist",
          }),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          typeof data?.error === "string"
            ? data.error
            : t("buildFromScratch.submitError"),
        );
      }
      trackEvent("builder branch waitlist joined", {
        location,
        source: "docs_build_from_scratch",
        useCase: "docs_build_online_waitlist",
      });
      setJoined(true);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("buildFromScratch.submitError"),
      );
    } finally {
      setJoining(false);
    }
  }, [email, location, t]);

  return (
    <Popover.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          trackEvent("click build online", { location });
        }
        setOpen(nextOpen);
      }}
    >
      <Popover.Trigger asChild>
        <button type="button" className={primaryButtonClassName}>
          {t("buildFromScratch.buildOnline")}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="center"
          sideOffset={8}
          collisionPadding={16}
          className="z-50 w-[min(100vw-32px,360px)] rounded-lg border border-[var(--code-border)] bg-[var(--bg)] p-4 shadow-lg"
        >
          <div className="space-y-3">
            <div>
              <p className="m-0 text-sm font-semibold text-[var(--fg)]">
                {t("buildFromScratch.popoverTitle")}
              </p>
              <p className="mt-2 mb-0 text-sm leading-relaxed text-[var(--fg-secondary)]">
                {t("buildFromScratch.popoverBody")}
              </p>
            </div>

            {joined ? (
              <p className="m-0 text-sm leading-relaxed text-[var(--docs-accent)]">
                {t("buildFromScratch.joined")}
              </p>
            ) : (
              <>
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder={t("buildFromScratch.emailPlaceholder")}
                  aria-label={t("buildFromScratch.emailLabel")}
                  autoComplete="email"
                  className="w-full rounded-lg border border-[var(--docs-border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--fg)] outline-none transition focus:border-[var(--fg-secondary)]"
                />
                {error ? (
                  <p className="m-0 text-xs text-red-600 dark:text-red-400">
                    {error}
                  </p>
                ) : null}
                <button
                  type="button"
                  onClick={() => void handleJoinWaitlist()}
                  disabled={joining}
                  className={primaryButtonClassName}
                >
                  {joining ? (
                    <>
                      <IconLoader2 size={16} className="animate-spin" />
                      {t("buildFromScratch.joining")}
                    </>
                  ) : (
                    t("buildFromScratch.joinWaitlist")
                  )}
                </button>
              </>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function BuildFromScratchCta({
  location,
}: {
  location: "homepage_rail" | "templates_index";
}) {
  const { locale } = useLocale();
  const t = useT();
  const docsPath = sitePathForLocale("/docs/getting-started", locale);

  return (
    <div className="build-from-scratch-cta flex w-[260px] shrink-0 flex-col justify-center gap-4 self-center px-4 py-2 sm:w-[280px] sm:px-5">
      <div className="space-y-1.5">
        <p className="m-0 text-base font-semibold text-[var(--fg)]">
          {t("buildFromScratch.title")}
        </p>
        <p className="m-0 text-sm leading-relaxed text-[var(--fg-secondary)]">
          {t("buildFromScratch.description")}
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <BuildOnlinePopover location={location} />
        <Link
          data-an-prefetch="render"
          to={docsPath}
          onClick={() =>
            trackEvent("start from scratch", {
              location,
              action: "read_docs",
            })
          }
          className={secondaryButtonClassName}
        >
          {t("buildFromScratch.readDocs")}
        </Link>
      </div>
    </div>
  );
}
