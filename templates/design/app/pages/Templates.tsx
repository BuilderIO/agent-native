import { useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useSetPageTitle } from "@agent-native/toolkit/app-shell";
import { useMemo } from "react";
import { useSearchParams } from "react-router";

import { QueryErrorState } from "@/components/QueryErrorState";
import { DesignTemplateLibrary } from "@/components/templates/DesignTemplateLibrary";
import { Input } from "@/components/ui/input";

export default function Templates() {
  const t = useT();
  const [searchParams, setSearchParams] = useSearchParams();
  const search = searchParams.get("search") ?? "";
  const { data, isLoading, isError, isFetching, refetch } = useActionQuery(
    "list-design-templates",
    { includePreview: "true" },
  );
  const templates = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (data?.templates ?? []).filter(
      (template) =>
        !query ||
        `${template.title} ${template.description ?? ""}`
          .toLowerCase()
          .includes(query),
    );
  }, [data?.templates, search]);
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
            const next = new URLSearchParams(searchParams);
            if (event.target.value) next.set("search", event.target.value);
            else next.delete("search");
            setSearchParams(next, { replace: true });
          }}
        />
      </div>
      {isError ? (
        <QueryErrorState onRetry={() => void refetch()} retrying={isFetching} />
      ) : (
        <DesignTemplateLibrary templates={templates} loading={isLoading} />
      )}
    </div>
  );
}
