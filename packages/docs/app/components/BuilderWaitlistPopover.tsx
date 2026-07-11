import { agentNativePath, trackEvent, useT } from "@agent-native/core/client";
import { IconLoader2 } from "@tabler/icons-react";
import { useCallback, useState } from "react";

import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";

export type BuilderWaitlistLocation =
  | "homepage_rail"
  | "templates_index"
  | "card";

type BuilderWaitlistProps = {
  location: BuilderWaitlistLocation;
  template?: string;
  source?: string;
  useCase?: string;
};

const primaryButtonClassName =
  "inline-flex w-full items-center justify-center gap-2 rounded-lg bg-black px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-800 dark:bg-white dark:text-black dark:hover:bg-gray-200";

export function BuilderWaitlistContent({
  location,
  template,
  source = "docs_build_from_scratch",
  useCase = "docs_build_online_waitlist",
}: BuilderWaitlistProps) {
  const t = useT();
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
            source,
            useCase,
            template,
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
        source,
        useCase,
        ...(template ? { template } : {}),
      });
      setJoined(true);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("buildFromScratch.submitError"),
      );
    } finally {
      setJoining(false);
    }
  }, [email, location, source, t, template, useCase]);

  return (
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
  );
}

export function BuildOnlinePopover({
  location,
}: {
  location: BuilderWaitlistLocation;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          trackEvent("click build online", { location });
        }
        setOpen(nextOpen);
      }}
    >
      <PopoverTrigger asChild>
        <button type="button" className={primaryButtonClassName}>
          {t("buildFromScratch.buildOnline")}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="center"
        sideOffset={8}
        collisionPadding={16}
        className="w-[min(100vw-32px,360px)] p-4"
      >
        <BuilderWaitlistContent location={location} />
      </PopoverContent>
    </Popover>
  );
}
