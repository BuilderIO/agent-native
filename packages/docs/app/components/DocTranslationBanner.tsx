import { useT } from "@agent-native/core/client/i18n";
import { Link } from "react-router";

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
