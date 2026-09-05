import { trackEvent } from "@agent-native/core/client/analytics";
import { useT } from "@agent-native/core/client/i18n";
import { IconExternalLink } from "@tabler/icons-react";
import { useState, type ReactElement } from "react";

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

export const BUILDER_SIGNUP_URL = "https://builder.io/signup";

export function BuilderLaunchLink({
  className = primaryButtonClassName,
  onClick,
}: {
  className?: string;
  onClick?: () => void;
}) {
  const t = useT();

  return (
    <a href={BUILDER_SIGNUP_URL} className={className} onClick={onClick}>
      <span>{t("buildFromScratch.launchBuilder")}</span>
      <IconExternalLink size={16} aria-hidden="true" />
    </a>
  );
}

export function BuilderWaitlistContent(_props: BuilderWaitlistProps) {
  const t = useT();

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
      <BuilderLaunchLink />
    </div>
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
