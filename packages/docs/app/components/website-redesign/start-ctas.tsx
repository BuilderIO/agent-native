import { trackEvent } from "@agent-native/core/client/analytics";
import { useLocale, useT } from "@agent-native/core/client/i18n";

import { sitePathForLocale } from "../docs-locale";
import { Button } from "./ds/button";

export type StartCtaLocation = "hero" | "bottom_cta";

export function StartCtas({ location }: { location: StartCtaLocation }) {
  const t = useT();
  const { locale } = useLocale();

  return (
    <div className="flex flex-wrap items-center justify-center gap-[var(--spacing-6)]">
      {/* Caps come from CSS, not the labels: all-caps accessible names are
          spelled out letter by letter by some screen readers. */}
      <Button
        variant="cta"
        icon={null}
        href={sitePathForLocale("/docs", locale)}
        className="uppercase"
        onClick={() => trackEvent("click get started", { location })}
      >
        {t("common.getStarted")}
      </Button>
      <Button
        variant="secondary"
        icon={null}
        href={sitePathForLocale("/apps", locale)}
        className="uppercase"
        onClick={() =>
          trackEvent("choose get started path", {
            option: "browse_apps",
            location,
          })
        }
      >
        {t("homepage.hero.tryAnApp")}
      </Button>
    </div>
  );
}
