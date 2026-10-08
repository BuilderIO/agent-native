import { trackEvent } from "@agent-native/core/client/analytics";
import { useLocale, useT } from "@agent-native/core/client/i18n";

import { sendAhrefsEvent } from "../../lib/ahrefs-analytics";
import { sitePathForLocale } from "../docs-locale";
import { Button } from "./ds/button";

export type StartCtaLocation = "hero" | "bottom_cta";

const AHREFS_LOCATION_PREFIX: Record<StartCtaLocation, string> = {
  hero: "hero",
  bottom_cta: "footer",
};

export function StartCtas({ location }: { location: StartCtaLocation }) {
  const t = useT();
  const { locale } = useLocale();
  const ahrefsPrefix = AHREFS_LOCATION_PREFIX[location];

  return (
    <div className="flex flex-wrap items-center justify-center gap-[var(--spacing-6)]">
      {/* Caps come from CSS, not the labels: all-caps accessible names are
          spelled out letter by letter by some screen readers. */}
      <Button
        variant="cta"
        icon={null}
        href={sitePathForLocale("/docs", locale)}
        className="uppercase"
        onClick={() => {
          trackEvent("click get started", { location });
          sendAhrefsEvent(`${ahrefsPrefix}_get_started_click`);
        }}
      >
        {t("common.getStarted")}
      </Button>
      <Button
        variant="secondary"
        icon={null}
        href={sitePathForLocale("/apps", locale)}
        className="uppercase"
        onClick={() => {
          trackEvent("choose get started path", {
            option: "browse_apps",
            location,
          });
          sendAhrefsEvent(`${ahrefsPrefix}_try_an_app_click`);
        }}
      >
        {t("homepage.hero.tryAnApp")}
      </Button>
    </div>
  );
}
