import { useT } from "@agent-native/core/client/i18n";
import { Link } from "react-router";

/**
 * Shown on a localized doc page that actually resolved to a translated file
 * (never on a locale route that fell back to the English source — that page
 * already IS the original, so a "refer to the original" banner would be
 * circular).
 */
export default function DocTranslationBanner({
  originalHref,
}: {
  originalHref: string;
}) {
  const t = useT();
  return (
    <div
      className="mb-6 rounded-md border p-4 text-sm text-muted-foreground"
      style={{ borderColor: "var(--docs-border)" }}
    >
      <strong className="text-foreground">{t("docs.translationLabel")}</strong>{" "}
      — {t("docs.translationDescription")}{" "}
      <Link
        to={originalHref}
        className="font-medium text-[var(--docs-accent)] underline"
      >
        {t("docs.translationViewOriginal")}
      </Link>
    </div>
  );
}
