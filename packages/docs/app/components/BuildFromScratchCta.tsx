import { trackEvent, useLocale, useT } from "@agent-native/core/client";
import { Link } from "react-router";

import { BuildOnlinePopover } from "./BuilderWaitlistPopover";
import { sitePathForLocale } from "./docs-locale";

const secondaryButtonClassName =
  "inline-flex w-full items-center justify-center rounded-lg border border-[var(--docs-border)] px-4 py-2 text-sm font-medium text-[var(--fg)] no-underline transition hover:border-[var(--fg-secondary)] hover:no-underline";

export function BuildFromScratchCta({
  location,
  variant = "rail",
}: {
  location: "homepage_rail" | "templates_index";
  variant?: "rail" | "grid";
}) {
  const { locale } = useLocale();
  const t = useT();
  const docsPath = sitePathForLocale("/docs/getting-started", locale);

  return (
    <div
      className={
        variant === "grid"
          ? "build-from-scratch-cta flex w-full max-w-[280px] flex-col justify-center gap-4 px-4 py-2 sm:px-5"
          : "build-from-scratch-cta flex w-[260px] shrink-0 flex-col justify-center gap-4 self-center px-4 py-2 sm:w-[280px] sm:px-5"
      }
    >
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
