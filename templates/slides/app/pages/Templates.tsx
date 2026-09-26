import { useT } from "@agent-native/core/client/i18n";
import { useSetPageTitle } from "@agent-native/toolkit/app-shell";
import { useSearchParams } from "react-router";

import { DeckTemplateLibrary } from "@/components/templates/DeckTemplateLibrary";
import { Input } from "@/components/ui/input";

export default function Templates() {
  const t = useT();
  const [params, setParams] = useSearchParams();
  const search = params.get("search") ?? "";
  useSetPageTitle(t("templatesPage.title"));
  return (
    <div className="mx-auto grid w-full max-w-370 gap-6 px-4 py-6 sm:px-6 lg:px-8">
      <div className="w-full max-w-175">
        <Input
          value={search}
          maxLength={200}
          aria-label={t("templatesPage.searchPlaceholder")}
          placeholder={t("templatesPage.searchPlaceholder")}
          onChange={(event) => {
            const next = new URLSearchParams(params);
            if (event.target.value) next.set("search", event.target.value);
            else next.delete("search");
            setParams(next, { replace: true });
          }}
        />
      </div>
      <DeckTemplateLibrary search={search} />
    </div>
  );
}
