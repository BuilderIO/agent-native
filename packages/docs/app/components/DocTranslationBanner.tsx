import { useT } from "@agent-native/core/client/i18n";
import { Link } from "react-router";

/**
 * Shown after the content on a localized doc page that actually resolved to a
 * translated file (never on a locale route that fell back to the English
 * source — that page already IS the original, so a "refer to the original"
 * banner would be circular).
 */
export default function DocTranslationBanner({
  originalHref,
}: {
  originalHref: string;
}) {
  const t = useT();
  return (
    <p className="docs-translation-note">
      {t("docs.translationLabel")} — {t("docs.translationDescription")}{" "}
      <Link to={originalHref}>{t("docs.translationViewOriginal")}</Link>
    </p>
  );
}
