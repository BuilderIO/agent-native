import { agentNativePath, useLocale, useT } from "@agent-native/core/client";
import * as Popover from "@radix-ui/react-popover";
import { IconBook, IconCloud, IconLoader2 } from "@tabler/icons-react";
import { useCallback, useState } from "react";
import { Link } from "react-router";

import { sitePathForLocale } from "./docs-locale";
import { trackEvent } from "./TemplateCard";

type BuildFromScratchLayout = "rail" | "banner";

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
        <button
          type="button"
          className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg border border-[var(--docs-border)] px-4 py-2 text-sm font-medium text-[var(--fg)] transition hover:border-[var(--fg-secondary)]"
        >
          <IconCloud size={16} stroke={1.75} />
          {t("buildFromScratch.buildOnline")}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="center"
          sideOffset={8}
          collisionPadding={16}
          className="z-50 w-[min(100vw-32px,360px)] rounded-xl border border-[var(--docs-border)] bg-[var(--bg)] p-4 shadow-lg"
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
                <label className="block space-y-1.5">
                  <span className="text-xs font-medium text-[var(--fg-secondary)]">
                    {t("buildFromScratch.emailLabel")}
                  </span>
                  <input
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder={t("buildFromScratch.emailPlaceholder")}
                    autoComplete="email"
                    className="w-full rounded-lg border border-[var(--docs-border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--fg)] outline-none transition focus:border-[var(--fg-secondary)]"
                  />
                </label>
                {error ? (
                  <p className="m-0 text-xs text-red-600 dark:text-red-400">
                    {error}
                  </p>
                ) : null}
                <button
                  type="button"
                  onClick={() => void handleJoinWaitlist()}
                  disabled={joining}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--fg)] px-4 py-2 text-sm font-medium text-[var(--bg)] transition hover:opacity-90 disabled:opacity-60"
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

export function BuildFromScratchCard({
  layout,
  location,
}: {
  layout: BuildFromScratchLayout;
  location: "homepage_rail" | "templates_index";
}) {
  const { locale } = useLocale();
  const t = useT();
  const docsPath = sitePathForLocale("/docs/getting-started", locale);

  const actions = (
    <div className="mt-auto flex flex-col gap-2 pt-3">
      <div className="flex gap-2">
        <Link
          data-an-prefetch="render"
          to={docsPath}
          onClick={() =>
            trackEvent("start from scratch", {
              location,
              action: "read_docs",
            })
          }
          className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-black px-4 py-2 text-sm font-medium text-white no-underline transition hover:bg-gray-800 hover:no-underline dark:bg-white dark:text-black dark:hover:bg-gray-200"
        >
          <IconBook size={16} stroke={1.75} />
          {t("buildFromScratch.readDocs")}
        </Link>
        <BuildOnlinePopover location={location} />
      </div>
    </div>
  );

  if (layout === "banner") {
    return (
      <div className="feature-card build-from-scratch-card flex flex-col gap-4 overflow-hidden sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 space-y-2">
          <h2 className="m-0 text-xl font-semibold text-[var(--fg)]">
            {t("buildFromScratch.title")}
          </h2>
          <p className="m-0 max-w-2xl text-sm leading-relaxed text-[var(--fg-secondary)]">
            {t("buildFromScratch.description")}
          </p>
        </div>
        <div className="flex w-full shrink-0 flex-col gap-2 sm:w-auto sm:min-w-[320px]">
          <div className="flex gap-2">
            <Link
              data-an-prefetch="render"
              to={docsPath}
              onClick={() =>
                trackEvent("start from scratch", {
                  location,
                  action: "read_docs",
                })
              }
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-black px-4 py-2 text-sm font-medium text-white no-underline transition hover:bg-gray-800 hover:no-underline dark:bg-white dark:text-black dark:hover:bg-gray-200"
            >
              <IconBook size={16} stroke={1.75} />
              {t("buildFromScratch.readDocs")}
            </Link>
            <BuildOnlinePopover location={location} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="feature-card build-from-scratch-card flex h-full flex-col gap-3 overflow-hidden">
      <div className="-mx-[24px] -mt-[24px] mb-1 flex aspect-[924/729] items-center justify-center overflow-hidden border-b border-[var(--docs-border)] bg-[linear-gradient(135deg,var(--bg-secondary),color-mix(in_srgb,var(--docs-accent)_18%,var(--bg-secondary)))] px-6 text-center">
        <div className="space-y-2">
          <p className="m-0 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--docs-accent)]">
            {t("buildFromScratch.eyebrow")}
          </p>
          <p className="m-0 text-lg font-semibold text-[var(--fg)]">
            {t("buildFromScratch.title")}
          </p>
        </div>
      </div>
      <p className="m-0 text-sm leading-relaxed text-[var(--fg-secondary)]">
        {t("buildFromScratch.description")}
      </p>
      {actions}
    </div>
  );
}
