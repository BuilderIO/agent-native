import { useT } from "@agent-native/core/client/i18n";

const BUILDER_TERMS_URL = "https://www.builder.io/legal/terms";
const BUILDER_PRIVACY_URL = "https://www.builder.io/legal/privacy";

/**
 * The terms under a button that creates a Builder.io account. Worded like the
 * Builder.io connect popover's, so the same account gets the same terms
 * wherever it is created.
 */
export function BuilderConsent() {
  const t = useT();
  const link = (href: string, label: string) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="underline underline-offset-2 hover:text-foreground"
    >
      {label}
    </a>
  );
  return (
    <p className="text-center text-xs leading-4 text-muted-foreground">
      {t("freeClips.consentPrefix")}{" "}
      {link(BUILDER_TERMS_URL, t("freeClips.consentTerms"))}{" "}
      {t("freeClips.consentAnd")}{" "}
      {link(BUILDER_PRIVACY_URL, t("freeClips.consentPrivacy"))}
      {t("freeClips.consentSuffix")}
    </p>
  );
}
