import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useFormatters, useT } from "@agent-native/core/client/i18n";
import { useOrgRole } from "@agent-native/core/client/org";
import {
  searchConsolePropertyProblem,
  type SearchConsolePropertyProblem,
} from "@shared/search-console-property";
import { IconCheck, IconCopy, IconPlus, IconTrash } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";

type ServiceAccount =
  | { status: "missing" }
  | { status: "invalid" }
  | { status: "ok"; email: string };

type SearchConsoleSite = { siteUrl: string; pathPrefix?: string };

type StepRun = {
  status: string;
  startedAt: string;
  errorCode: string | null;
  errorMessage: string | null;
};

export type ContentCollectionStatus = {
  configured: boolean;
  enabled: boolean;
  config: {
    searchConsole: { enabled: boolean; sites: SearchConsoleSite[] };
  } | null;
  serviceAccount: ServiceAccount;
  steps: Array<{ step: string; enabled: boolean; lastRun: StepRun | null }>;
};

export type SearchConsoleState =
  | "collecting"
  | "needs_access"
  | "failed"
  | "unavailable"
  | "off";

export function searchConsoleState(
  status: ContentCollectionStatus | undefined,
  error?: unknown,
): SearchConsoleState {
  if (error || !status) return "unavailable";
  const step = status?.steps.find((entry) => entry.step === "search_console");
  if (!status?.enabled || !step?.enabled) return "off";
  switch (step.lastRun?.status) {
    case "succeeded":
    case "running":
    case undefined:
      return "collecting";
    case "not_configured":
      return step.lastRun?.errorCode === "no_search_console_sites"
        ? "off"
        : "needs_access";
    default:
      return "failed";
  }
}

export function useContentCollectionStatus() {
  return useActionQuery("get-content-collection", undefined, {
    staleTime: 10_000,
    retry: false,
  }) as {
    data: ContentCollectionStatus | undefined;
    isLoading: boolean;
    error: unknown;
  };
}

function ServiceAccountRow({ account }: { account: ServiceAccount }) {
  const t = useT();
  const [copied, setCopied] = useState(false);

  if (account.status === "missing") {
    return (
      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>{t("dataSources.searchConsole.noServiceAccount")}</span>
        <Button asChild size="sm" variant="outline" className="text-xs">
          <Link to="/data-sources?source=gcloud">
            {t("dataSources.searchConsole.openGoogleCloud")}
          </Link>
        </Button>
      </div>
    );
  }
  if (account.status === "invalid") {
    return (
      <p className="text-xs text-destructive">
        {t("dataSources.searchConsole.invalidServiceAccount")}
      </p>
    );
  }

  const copy = async () => {
    await navigator.clipboard?.writeText(account.email);
    setCopied(true);
  };
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-foreground">
        {t("dataSources.searchConsole.serviceAccount")}
      </p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-md bg-muted/40 px-2 py-1.5 font-mono text-xs">
          {account.email}
        </code>
        <Button
          size="sm"
          variant="outline"
          onClick={copy}
          aria-label={t("dataSources.searchConsole.copyEmail")}
          className="h-8 w-8 p-0"
        >
          {copied ? (
            <IconCheck className="h-3.5 w-3.5" />
          ) : (
            <IconCopy className="h-3.5 w-3.5" />
          )}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {t("dataSources.searchConsole.grantHint")}
      </p>
    </div>
  );
}

function LastRun({ run }: { run: StepRun }) {
  const t = useT();
  const formatters = useFormatters();
  const when = formatters.formatDate(run.startedAt, {
    dateStyle: "medium",
    timeStyle: "short",
  });
  const tone =
    run.status === "succeeded"
      ? "text-emerald-600 dark:text-emerald-400"
      : run.status === "not_configured"
        ? "text-amber-600 dark:text-amber-400"
        : run.status === "running"
          ? "text-muted-foreground"
          : "text-destructive";
  const label =
    run.status === "succeeded"
      ? t("dataSources.searchConsole.runSucceeded", { when })
      : run.status === "not_configured"
        ? run.errorCode === "no_search_console_sites"
          ? t("dataSources.notConfigured")
          : t("dataSources.searchConsole.runNeedsAccess", { when })
        : run.status === "running"
          ? t("dataSources.searchConsole.runRunning", { when })
          : t("dataSources.searchConsole.runFailed", { when });
  return (
    <div className="space-y-1 text-xs">
      <p className={tone}>{label}</p>
      {run.errorCode === "google_credentials_unreadable" ? (
        <p className="break-words text-muted-foreground">
          {t("dataSources.searchConsole.keyUnreadable")}
        </p>
      ) : (
        run.errorMessage &&
        run.status !== "succeeded" && (
          <p className="break-words text-muted-foreground">
            {run.errorMessage}
          </p>
        )
      )}
    </div>
  );
}

function PropertyProblem({
  problem,
}: {
  problem: SearchConsolePropertyProblem;
}) {
  const t = useT();
  const text =
    problem.kind === "bare_domain"
      ? t("dataSources.searchConsole.propertyBareDomain", {
          suggestion: problem.suggestion,
        })
      : problem.kind === "missing_trailing_slash"
        ? t("dataSources.searchConsole.propertyMissingSlash", {
            suggestion: problem.suggestion,
          })
        : problem.kind === "invalid_domain" && problem.suggestion
          ? t("dataSources.searchConsole.propertyInvalidDomain", {
              suggestion: problem.suggestion,
            })
          : t("dataSources.searchConsole.propertyUnrecognized");
  return <p className="text-xs text-destructive">{text}</p>;
}

export function SearchConsoleDetail() {
  const t = useT();
  const queryClient = useQueryClient();
  const { canManageOrg } = useOrgRole();
  const { data: status, isLoading, error } = useContentCollectionStatus();
  const savedSites = status?.config?.searchConsole.sites;
  const savedEnabled = status?.config?.searchConsole.enabled ?? false;
  const [sites, setSites] = useState<SearchConsoleSite[]>([]);
  const [touched, setTouched] = useState<ReadonlySet<number>>(new Set());

  const savedSitesKey = JSON.stringify(savedSites ?? []);
  useEffect(() => {
    const saved = JSON.parse(savedSitesKey) as SearchConsoleSite[];
    setSites(saved.length ? saved : [{ siteUrl: "" }]);
    setTouched(new Set());
  }, [savedSitesKey]);

  const configure = useActionMutation("configure-content-collection", {
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["action", "get-content-collection"],
      });
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
      </div>
    );
  }
  if (error || !status) {
    return (
      <p className="text-xs text-destructive">
        {t("dataSources.searchConsole.unavailable", {
          message: error instanceof Error ? error.message : String(error),
        })}
      </p>
    );
  }

  const cleanSites = sites
    .map((site) => ({
      siteUrl: site.siteUrl.trim(),
      ...(site.pathPrefix?.trim()
        ? { pathPrefix: site.pathPrefix.trim() }
        : {}),
    }))
    .filter((site) => site.siteUrl);
  const dirty = JSON.stringify(cleanSites) !== savedSitesKey;
  const problems = sites.map((site) =>
    site.siteUrl.trim() ? searchConsolePropertyProblem(site.siteUrl) : null,
  );
  const hasProblem = problems.some(Boolean);
  const checked = configure.isPending
    ? Boolean(
        (configure.variables as { searchConsole?: boolean } | undefined)
          ?.searchConsole,
      )
    : savedEnabled;
  const lastRun = status.steps.find(
    (step) => step.step === "search_console",
  )?.lastRun;

  const save = (enabled: boolean, includeDraft = true) => {
    configure.mutate({
      // Turning Search Console on turns the daily collection on with it;
      // turning it off leaves the other steps as they were.
      enabled: enabled || status.enabled,
      searchConsole: enabled,
      ...(includeDraft ? { searchConsoleSites: cleanSites } : {}),
    });
  };

  const updateSite = (index: number, patch: Partial<SearchConsoleSite>) => {
    setSites((current) =>
      current.map((site, i) => (i === index ? { ...site, ...patch } : site)),
    );
  };

  return (
    <div className="space-y-5">
      <ServiceAccountRow account={status.serviceAccount} />

      <div className="space-y-2">
        <p className="text-xs font-medium text-foreground">
          {t("dataSources.searchConsole.properties")}
        </p>
        {sites.map((site, index) => (
          <div key={index} className="space-y-1">
            <div className="flex items-center gap-2">
              <Input
                value={site.siteUrl}
                onChange={(event) =>
                  updateSite(index, { siteUrl: event.target.value })
                }
                onBlur={() =>
                  setTouched((current) => new Set(current).add(index))
                }
                placeholder="sc-domain:example.com"
                aria-label={t("dataSources.searchConsole.siteLabel")}
                aria-invalid={touched.has(index) && Boolean(problems[index])}
                disabled={!canManageOrg}
                className="h-8 flex-1 font-mono text-xs"
              />
              <Input
                value={site.pathPrefix ?? ""}
                onChange={(event) =>
                  updateSite(index, { pathPrefix: event.target.value })
                }
                placeholder="/blog/"
                aria-label={t("dataSources.searchConsole.pathLabel")}
                disabled={!canManageOrg}
                className="h-8 w-28 font-mono text-xs"
              />
              {canManageOrg && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setSites((current) =>
                      current.filter((_, i) => i !== index),
                    );
                    setTouched(
                      (current) =>
                        new Set(
                          [...current].flatMap((i) =>
                            i === index ? [] : [i < index ? i : i - 1],
                          ),
                        ),
                    );
                  }}
                  aria-label={t("dataSources.searchConsole.removeProperty")}
                  className="h-8 w-8 p-0"
                >
                  <IconTrash className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
            {touched.has(index) && problems[index] && (
              <PropertyProblem problem={problems[index]} />
            )}
          </div>
        ))}
        {canManageOrg && (
          <div className="flex items-center justify-between gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                setSites((current) => [...current, { siteUrl: "" }])
              }
              className="text-xs"
            >
              <IconPlus className="mr-1 h-3.5 w-3.5" />
              {t("dataSources.searchConsole.addProperty")}
            </Button>
            {dirty && (
              <Button
                size="sm"
                onClick={() => save(savedEnabled)}
                disabled={
                  configure.isPending ||
                  hasProblem ||
                  (savedEnabled && cleanSites.length === 0)
                }
                className="text-xs"
              >
                {t("dataSources.searchConsole.save")}
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-3">
        <label
          htmlFor="search-console-collect"
          className="text-xs font-medium text-foreground"
        >
          {t("dataSources.searchConsole.collectDaily")}
        </label>
        <Switch
          id="search-console-collect"
          checked={checked}
          disabled={
            !canManageOrg ||
            configure.isPending ||
            (!checked && (cleanSites.length === 0 || hasProblem))
          }
          onCheckedChange={(checked) => save(checked, checked)}
        />
      </div>
      {!canManageOrg && (
        <p className="text-xs text-muted-foreground">
          {t("dataSources.searchConsole.adminOnly")}
        </p>
      )}
      {configure.error && (
        <p className="text-xs text-destructive">
          {configure.error instanceof Error
            ? configure.error.message
            : String(configure.error)}
        </p>
      )}
      {lastRun && savedEnabled && <LastRun run={lastRun} />}
    </div>
  );
}
