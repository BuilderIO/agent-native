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
  const { data, error, isLoading, isError, isFetching, refetch } =
    useActionQuery(
      "list-design-templates",
      { includePreview: "true" },
      { refetchOnMount: "always" },
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
  const failure = error as { status?: number; errorCode?: string } | null;
  const accessDenied =
    [401, 403, 404].includes(failure?.status ?? 0) ||
    ["unauthorized", "forbidden", "not_found"].includes(
      failure?.errorCode ?? "",
    );
  const showError = isError && (data === undefined || accessDenied);
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
      ) : null}
      {!showError ? (
        <DesignTemplateLibrary templates={templates} loading={isLoading} />
      ) : null}
    </div>
  );
}
