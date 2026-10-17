import {
  getConsentChoice,
  resolveConsentRegion,
  setConsentChoice,
  shouldShowConsentBanner,
  subscribeConsent,
} from "@agent-native/core/client/consent";
import { useT } from "@agent-native/core/client/i18n";
import { Button } from "@agent-native/toolkit/ui/button";
import { Label } from "@agent-native/toolkit/ui/label";
import { Switch } from "@agent-native/toolkit/ui/switch";
import { useEffect, useState, useSyncExternalStore } from "react";

const DEFAULT_PRIVACY_POLICY_HREF = "https://www.agent-native.com/privacy";

/**
 * The cookie banner for visitors in the consent region. Renders nothing
 * elsewhere, and nothing once the visitor has chosen, until
 * `openConsentSettings()` reopens it.
 */
export function ConsentBanner({
  privacyPolicyHref = DEFAULT_PRIVACY_POLICY_HREF,
}: {
  privacyPolicyHref?: string;
}) {
  const t = useT();
  const open = useSyncExternalStore(
    subscribeConsent,
    shouldShowConsentBanner,
    () => false,
  );
  const [managing, setManaging] = useState(false);
  const [performance, setPerformance] = useState(false);
  const [targeting, setTargeting] = useState(false);

  useEffect(() => {
    void resolveConsentRegion();
  }, []);

  useEffect(() => {
    if (!open) return;
    const stored = getConsentChoice();
    setPerformance(stored?.performance ?? false);
    setTargeting(stored?.targeting ?? false);
    setManaging(false);
  }, [open]);

  if (!open) return null;

  return (
    <section
      role="region"
      aria-label={t("consentBanner.label")}
      data-agent-native-consent-banner
      className="fixed bottom-4 left-4 z-[100] flex w-[min(420px,calc(100vw-2rem))] flex-col gap-3 rounded-lg border bg-popover p-4 text-sm text-popover-foreground shadow-lg"
    >
      <p className="m-0 leading-relaxed">
        {t("consentBanner.message")}{" "}
        <a
          href={privacyPolicyHref}
          target="_blank"
          rel="noreferrer"
          className="underline underline-offset-2"
        >
          {t("consentBanner.privacyPolicy")}
        </a>
      </p>
      {managing ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="an-consent-necessary">
              {t("consentBanner.necessary")}
            </Label>
            <Switch id="an-consent-necessary" checked disabled />
          </div>
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="an-consent-performance">
              {t("consentBanner.performance")}
            </Label>
            <Switch
              id="an-consent-performance"
              checked={performance}
              onCheckedChange={setPerformance}
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="an-consent-targeting">
              {t("consentBanner.targeting")}
            </Label>
            <Switch
              id="an-consent-targeting"
              checked={targeting}
              onCheckedChange={setTargeting}
            />
          </div>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          className="flex-1"
          onClick={() =>
            setConsentChoice({ performance: false, targeting: false })
          }
        >
          {t("consentBanner.rejectAll")}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="flex-1"
          onClick={() =>
            setConsentChoice({ performance: true, targeting: true })
          }
        >
          {t("consentBanner.acceptAll")}
        </Button>
        {managing ? (
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            onClick={() => setConsentChoice({ performance, targeting })}
          >
            {t("consentBanner.save")}
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="flex-1"
            onClick={() => setManaging(true)}
          >
            {t("consentBanner.manage")}
          </Button>
        )}
      </div>
    </section>
  );
}
