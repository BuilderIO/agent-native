import { useT } from "@agent-native/core/client/i18n";

export default function DocDraftBanner() {
  const t = useT();
  return (
    <div
      className="mb-6 rounded-md border p-4 text-sm"
      style={{
        borderColor: "var(--approaches-warn)",
        color: "var(--approaches-warn)",
      }}
    >
      <strong>{t("docs.draftLabel")}</strong> — {t("docs.draftDescription")}
    </div>
  );
}
