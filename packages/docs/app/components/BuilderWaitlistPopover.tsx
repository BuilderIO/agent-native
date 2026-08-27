import { trackEvent } from "@agent-native/core/client/analytics";
import { agentNativePath } from "@agent-native/core/client/api-path";
import { useT } from "@agent-native/core/client/i18n";
import { IconLoader2, IconX } from "@tabler/icons-react";
import { useCallback, useId, useState, type ReactElement } from "react";

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";

export type BuilderWaitlistLocation =
  | "homepage_rail"
  | "templates_index"
  | "card"
  | "getting_started";

type BuilderWaitlistProps = {
  location: BuilderWaitlistLocation;
  template?: string;
  source?: string;
  useCase?: string;
  showIntro?: boolean;
};

const primaryButtonClassName =
  "inline-flex w-full items-center justify-center gap-2 rounded-md bg-black px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-800 dark:bg-white dark:text-black dark:hover:bg-gray-200";

export function BuilderWaitlistContent({
  location,
  template,
  source = "docs_build_from_scratch",
  useCase = "docs_build_online_waitlist",
  showIntro = true,
}: BuilderWaitlistProps) {
  const t = useT();
  const emailId = useId();
  const errorId = `${emailId}-error`;
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
      {showIntro ? (
        <div>
          <p className="m-0 text-sm font-semibold text-[var(--fg)]">
            {t("buildFromScratch.popoverTitle")}
          </p>
          <p className="mt-2 mb-0 text-sm leading-relaxed text-[var(--fg-secondary)]">
            {t("buildFromScratch.popoverBody")}
          </p>
        </div>
      ) : null}

      {joined ? (
        <p className="m-0 text-sm leading-relaxed text-[var(--docs-accent)]">
          {t("buildFromScratch.joined")}
        </p>
      ) : (
        <>
          <div className="grid gap-2">
            <label
              htmlFor={emailId}
              className="text-xs font-medium text-[var(--fg-secondary)]"
            >
              {t("buildFromScratch.emailLabel")}
            </label>
            <input
              id={emailId}
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder={t("buildFromScratch.emailPlaceholder")}
              autoComplete="email"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? errorId : undefined}
              className="w-full rounded-lg border border-[var(--docs-border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--fg)] outline-none transition-[border-color,box-shadow] focus:border-[var(--docs-accent)] focus:ring-2 focus:ring-[var(--docs-accent)]/20"
            />
            {error ? (
              <p
                id={errorId}
                role="alert"
                className="m-0 text-xs text-red-600 dark:text-red-400"
              >
                {error}
              </p>
            ) : null}
          </div>
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

export function BuildOnlineDialog({
  location,
  trigger,
  onOpen,
}: {
  location: BuilderWaitlistLocation;
  trigger: ReactElement;
  onOpen?: () => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          trackEvent("click build online", { location });
          onOpen?.();
        }
        setOpen(nextOpen);
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="!max-w-[440px] rounded-xl border border-[var(--docs-border)] bg-[var(--bg)] p-6 text-[var(--fg)] shadow-2xl">
        <DialogTitle className="m-0 pe-10 text-lg font-semibold">
          {t("buildFromScratch.dialogTitle")}
        </DialogTitle>
        <div className="mt-5">
          <BuilderWaitlistContent location={location} showIntro={false} />
        </div>
        <DialogClose asChild>
          <button
            type="button"
            aria-label={t("common.close")}
            className="absolute top-4 end-4 inline-flex size-8 items-center justify-center rounded-md text-[var(--fg-secondary)] transition-[background-color,color] hover:bg-[var(--bg-secondary)] hover:text-[var(--fg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--docs-accent)]"
          >
            <IconX className="size-4" aria-hidden="true" />
          </button>
        </DialogClose>
      </DialogContent>
    </Dialog>
  );
}

export function BuildOnlinePopover({
  location,
  trigger,
  onOpen,
}: {
  location: BuilderWaitlistLocation;
  // Redesign surfaces style their buttons from the --b-* token system; the
  // default trigger below belongs to the older docs button vocabulary.
  trigger?: ReactElement;
  onOpen?: () => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          trackEvent("click build online", { location });
          onOpen?.();
        }
        setOpen(nextOpen);
      }}
    >
      <PopoverTrigger asChild>
        {trigger ?? (
          <button type="button" className={primaryButtonClassName}>
            {t("buildFromScratch.buildOnline")}
          </button>
        )}
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
