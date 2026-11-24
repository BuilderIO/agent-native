import {
  getConsentChoice,
  resolveConsentRegion,
  setConsentChoice,
  shouldShowConsentBanner,
  subscribeConsent,
} from "@agent-native/core/client/consent";
import { useT } from "@agent-native/core/client/i18n";
import type { ConsentBannerMessages } from "@agent-native/core/localization/privacy-choice-messages";
import { Button } from "@agent-native/toolkit/ui/button";
import { Label } from "@agent-native/toolkit/ui/label";
import { Switch } from "@agent-native/toolkit/ui/switch";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

const DEFAULT_PRIVACY_POLICY_HREF = "https://www.agent-native.com/privacy";

type ConsentBannerProps = {
  privacyPolicyHref?: string;
  automaticPrompt?: boolean;
};

/**
 * The cookie banner for visitors in the consent region. Renders nothing
 * elsewhere, and nothing once the visitor has chosen, until
 * `openConsentSettings()` reopens it.
 */
export function ConsentBanner(props: ConsentBannerProps) {
  const t = useT();
  const messages = useMemo(
    () => ({
      label: t("consentBanner.label"),
      message: t("consentBanner.message"),
      privacyPolicy: t("consentBanner.privacyPolicy"),
      necessary: t("consentBanner.necessary"),
      performance: t("consentBanner.performance"),
      targeting: t("consentBanner.targeting"),
      rejectAll: t("consentBanner.rejectAll"),
      acceptAll: t("consentBanner.acceptAll"),
      save: t("consentBanner.save"),
      manage: t("consentBanner.manage"),
    }),
    [t],
  );
  return <ConsentBannerPanel {...props} messages={messages} />;
}

/**
 * `ConsentBanner` with its copy passed in, for the sign-in page, which has
 * its own locale and no i18n provider.
 */
export function ConsentBannerPanel({
  messages,
  privacyPolicyHref = DEFAULT_PRIVACY_POLICY_HREF,
  automaticPrompt = true,
}: ConsentBannerProps & {
  messages: Omit<ConsentBannerMessages, "cookieSettings">;
}) {
  const open = useSyncExternalStore(
    subscribeConsent,
    () => shouldShowConsentBanner(automaticPrompt),
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
      aria-label={messages.label}
      data-agent-native-consent-banner
      className="fixed bottom-4 left-4 z-[100] flex w-[min(420px,calc(100vw-2rem))] flex-col gap-3 rounded-lg border bg-popover p-4 text-sm text-popover-foreground shadow-lg"
    >
      <p className="m-0 leading-relaxed">
        {messages.message}{" "}
        <a
          href={privacyPolicyHref}
          target="_blank"
          rel="noreferrer"
          className="underline underline-offset-2"
        >
          {messages.privacyPolicy}
        </a>
      </p>
      {managing ? (
        <div data-consent-settings className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="an-consent-necessary">{messages.necessary}</Label>
            <Switch id="an-consent-necessary" checked disabled />
          </div>
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="an-consent-performance">
              {messages.performance}
            </Label>
            <Switch
              id="an-consent-performance"
              checked={performance}
              onCheckedChange={setPerformance}
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="an-consent-targeting">{messages.targeting}</Label>
            <Switch
              id="an-consent-targeting"
              checked={targeting}
              onCheckedChange={setTargeting}
            />
          </div>
        </div>
      ) : null}
      <div data-consent-actions className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          className="flex-1"
          onClick={() =>
            setConsentChoice({ performance: false, targeting: false })
          }
        >
          {messages.rejectAll}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="flex-1"
          onClick={() =>
            setConsentChoice({ performance: true, targeting: true })
          }
        >
          {messages.acceptAll}
        </Button>
        {managing ? (
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            onClick={() => setConsentChoice({ performance, targeting })}
          >
            {messages.save}
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="flex-1"
            data-consent-manage
            onClick={() => setManaging(true)}
          >
            {messages.manage}
          </Button>
        )}
      </div>
    </section>
  );
}
