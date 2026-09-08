import { trackEvent } from "@agent-native/core/client/analytics";
import { agentNativePath } from "@agent-native/core/client/api-path";
import { useT } from "@agent-native/core/client/i18n";
import { IconExternalLink, IconLoader2 } from "@tabler/icons-react";
import {
  cloneElement,
  useCallback,
  useId,
  useState,
  type MouseEventHandler,
  type ReactElement,
} from "react";

import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";

export type BuilderWaitlistLocation =
  | "homepage_rail"
  | "templates_index"
  | "card"
  | "template_detail"
  | "getting_started";

type BuilderWaitlistProps = {
  location: BuilderWaitlistLocation;
  template?: string;
  source?: string;
  useCase?: string;
};

const primaryButtonClassName =
  "inline-flex w-full items-center justify-center gap-2 rounded-md bg-black px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-800 dark:bg-white dark:text-black dark:hover:bg-gray-200";

type BuilderLaunchTrigger = ReactElement<{
  href?: string;
  onClick?: MouseEventHandler<HTMLElement>;
}>;

// Flip this when Builder's hosted agent-native app flow is ready for launch.
export const BUILDER_BUILD_ONLINE_SUPPORTED = false;
export const BUILDER_SIGNUP_URL = "https://builder.io/signup";

export function BuilderLaunchLink({
  className = primaryButtonClassName,
  onClick,
  trigger,
}: {
  className?: string;
  onClick?: () => void;
  trigger?: BuilderLaunchTrigger;
}) {
  const t = useT();

  if (trigger) {
    return cloneElement(trigger, {
      href: BUILDER_SIGNUP_URL,
      onClick: (event) => {
        trigger.props.onClick?.(event);
        if (!event.defaultPrevented) onClick?.();
      },
    });
  }

  return (
    <a href={BUILDER_SIGNUP_URL} className={className} onClick={onClick}>
      <span>{t("buildFromScratch.launchBuilder")}</span>
      <IconExternalLink size={16} aria-hidden="true" />
    </a>
  );
}

export function BuilderWaitlistContent({
  location,
  template,
  source = "docs_build_from_scratch",
  useCase = "docs_build_online_waitlist",
}: BuilderWaitlistProps) {
  const t = useT();
  const emailId = useId();
  const errorId = `${emailId}-error`;
  const [email, setEmail] = useState("");
  const [joining, setJoining] = useState(false);
  const [joined, setJoined] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleJoinWaitlist = useCallback(async () => {
    const trimmed = email.trim();
    setUnavailable(false);
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
      if (!res.ok) {
        throw new Error(t("buildFromScratch.submitError"));
      }
      let data: unknown;
      try {
        data = await res.json();
      } catch {
        throw new Error(t("buildFromScratch.submitError"));
      }
      if (
        typeof data !== "object" ||
        data === null ||
        !("formSubmitted" in data) ||
        typeof data.formSubmitted !== "boolean"
      ) {
        throw new Error(t("buildFromScratch.submitError"));
      }
      if (!data.formSubmitted) {
        setUnavailable(true);
        return;
      }
      trackEvent("builder branch waitlist joined", {
        location,
        source,
        useCase,
        ...(template ? { template } : {}),
      });
      setJoined(true);
    } catch {
      setError(t("buildFromScratch.submitError"));
    } finally {
      setJoining(false);
    }
  }, [email, location, source, t, template, useCase]);

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        void handleJoinWaitlist();
      }}
    >
      <div>
        <p className="m-0 text-sm font-semibold text-[var(--fg)]">
          {t("buildFromScratch.popoverTitle")}
        </p>
        <p className="mt-2 mb-0 text-sm leading-relaxed text-[var(--fg-secondary)]">
          {t(
            BUILDER_BUILD_ONLINE_SUPPORTED
              ? "buildFromScratch.popoverBody"
              : "buildFromScratch.waitlistBody",
          )}
        </p>
      </div>

      {BUILDER_BUILD_ONLINE_SUPPORTED ? (
        <BuilderLaunchLink />
      ) : joined ? (
        <p
          role="status"
          aria-live="polite"
          className="m-0 text-sm leading-relaxed text-[var(--docs-accent)]"
        >
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
            {unavailable ? (
              <p
                role="status"
                aria-live="polite"
                className="m-0 text-xs text-[var(--fg-secondary)]"
              >
                {t("buildFromScratch.waitlistUnavailable")}
              </p>
            ) : null}
          </div>
          <button
            type="submit"
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
    </form>
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
  trigger?: BuilderLaunchTrigger;
  onOpen?: () => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const handleOpen = () => {
    trackEvent("click build online", { location });
    onOpen?.();
  };

  if (BUILDER_BUILD_ONLINE_SUPPORTED) {
    return <BuilderLaunchLink trigger={trigger} onClick={handleOpen} />;
  }

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) handleOpen();
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

export function BuilderLaunchAction({
  location,
  className = primaryButtonClassName,
  onClick,
}: {
  location: BuilderWaitlistLocation;
  className?: string;
  onClick?: () => void;
}) {
  const t = useT();
  const handleLaunch = () => {
    trackEvent("click build online", { location });
    onClick?.();
  };

  if (BUILDER_BUILD_ONLINE_SUPPORTED) {
    return <BuilderLaunchLink className={className} onClick={handleLaunch} />;
  }

  return (
    <BuildOnlinePopover
      location={location}
      onOpen={onClick}
      trigger={
        <button type="button" className={className}>
          {t("buildFromScratch.joinWaitlist")}
        </button>
      }
    />
  );
}
