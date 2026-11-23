import { useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { IconPlus, IconSearch, IconX } from "@tabler/icons-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import type { ProjectLanguage } from "@/lib/model/contracts";

import type { EnvironmentReport } from "../../../server/model/environment-packages";

function EnvironmentField({ label, value }: { label: string; value: string }) {
  return (
    <div className="nb-environment-field">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function EnvironmentDescription({
  children,
  href,
  linkLabel,
}: {
  children: string;
  href: string;
  linkLabel: string;
}) {
  return (
    <p>
      {children}{" "}
      <a href={href} target="_blank" rel="noreferrer">
        {linkLabel}
      </a>
    </p>
  );
}

export function ProjectEnvironmentPanel({
  language,
  onClose,
}: {
  language: ProjectLanguage;
  onClose: () => void;
}) {
  const t = useT();
  const isPython = language === "python";
  const query = useActionQuery<EnvironmentReport>(
    "list-environment-packages",
    {},
    { enabled: isPython },
  );
  const [filter, setFilter] = useState("");
  const needle = filter.trim().toLowerCase();
  const packages = query.data?.packages.filter((pkg) =>
    pkg.name.toLowerCase().includes(needle),
  );
  const runtime = query.data?.runtime;
  const runtimeLabel = runtime
    ? [runtime, query.data?.runtimeVersion].filter(Boolean).join(" ")
    : undefined;
  const unavailable = t("projectEnvironment.unavailable");
  const learnMore = t("projectEnvironment.learnMore");

  return (
    <aside
      className="nb-side-panel nb-environment"
      aria-label={t("projectEnvironment.environment")}
    >
      <section className="nb-environment-section">
        <div className="nb-environment-section-header">
          <h3>{t("projectEnvironment.computeProfile")}</h3>
          <button
            type="button"
            className="nb-side-panel-close"
            aria-label={t("projectEnvironment.close")}
            onClick={onClose}
          >
            <IconX size={14} aria-hidden="true" />
          </button>
        </div>
        <EnvironmentDescription
          href="https://learn.hex.tech/docs/explore-data/projects/environment-configuration/environment-views#compute-profiles"
          linkLabel={learnMore}
        >
          {t("projectEnvironment.computeDescription")}
        </EnvironmentDescription>
        <dl className="nb-environment-compact-fields">
          <EnvironmentField
            label={t("projectEnvironment.image")}
            value={unavailable}
          />
          <EnvironmentField
            label={t("projectEnvironment.size")}
            value={unavailable}
          />
          <EnvironmentField
            label={t("projectEnvironment.idleTimeout")}
            value={unavailable}
          />
        </dl>
      </section>
      <section className="nb-environment-section">
        <h3>{t("projectEnvironment.projectTimezone")}</h3>
        <EnvironmentDescription
          href="https://learn.hex.tech/docs/explore-data/cells/visualization-cells/chart-cells#chart-cell-timezones"
          linkLabel={learnMore}
        >
          {t("projectEnvironment.timezoneDescription")}
        </EnvironmentDescription>
        <dl className="nb-environment-compact-fields">
          <EnvironmentField
            label={t("projectEnvironment.timezone")}
            value={unavailable}
          />
        </dl>
      </section>
      <section className="nb-environment-section">
        <h3>{t("projectEnvironment.sqlCaching")}</h3>
        <EnvironmentDescription
          href="https://learn.hex.tech/docs/explore-data/cells/sql-cells/query-caching"
          linkLabel={learnMore}
        >
          {t("projectEnvironment.cachingDescription")}
        </EnvironmentDescription>
        <dl>
          <EnvironmentField
            label={t("projectEnvironment.useCachedResults")}
            value={unavailable}
          />
        </dl>
        <p>{t("projectEnvironment.cachedResultsDescription")}</p>
        <dl className="nb-environment-stacked-field">
          <EnvironmentField
            label={t("projectEnvironment.rerunAge")}
            value={unavailable}
          />
        </dl>
      </section>
      <section className="nb-environment-section">
        <h3>{t("projectEnvironment.executionOrder")}</h3>
        <dl>
          <EnvironmentField
            label={t("projectEnvironment.allowReordering")}
            value={unavailable}
          />
        </dl>
        <EnvironmentDescription
          href="https://learn.hex.tech/docs/explore-data/projects/environment-configuration/environment-views#cell-execution-order"
          linkLabel={learnMore}
        >
          {t("projectEnvironment.reorderingDescription")}
        </EnvironmentDescription>
      </section>
      <section className="nb-environment-section">
        <div className="nb-environment-section-header">
          <h3>{t("projectEnvironment.gitPackages")}</h3>
          <Button type="button" variant="ghost" size="xs" disabled>
            <IconPlus aria-hidden="true" />
            {t("projectEnvironment.add")}
          </Button>
        </div>
        <EnvironmentDescription
          href="https://learn.hex.tech/docs/explore-data/projects/environment-configuration/using-packages#github-packages"
          linkLabel={learnMore}
        >
          {t(
            isPython
              ? "projectEnvironment.gitDescriptionPython"
              : "projectEnvironment.gitDescriptionR",
          )}
        </EnvironmentDescription>
        <p className="nb-environment-empty">{unavailable}</p>
      </section>
      <section className="nb-environment-section nb-environment-packages">
        <h3>{t("projectEnvironment.preinstalled")}</h3>
        {!isPython ? (
          <p>{unavailable}</p>
        ) : (
          <>
            {runtimeLabel && (
              <p>
                {t("projectEnvironment.runtime", { runtime: runtimeLabel })}
              </p>
            )}
            <div className="nb-environment-filter">
              <IconSearch size={14} aria-hidden="true" />
              <Input
                size="sm"
                type="search"
                aria-label={t("projectEnvironment.filterPackages")}
                placeholder={t("projectEnvironment.filterPlaceholder")}
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    setFilter("");
                  }
                }}
              />
            </div>
            {query.error != null ? (
              <p className="nb-environment-empty" role="alert">
                {t("projectEnvironment.loadError")}
              </p>
            ) : query.isPending ? (
              <div role="status" aria-label={t("projectEnvironment.loading")}>
                <Skeleton className="h-20 w-full" />
              </div>
            ) : packages?.length === 0 ? (
              <p className="nb-environment-empty">
                {t(
                  needle
                    ? "projectEnvironment.noMatches"
                    : "projectEnvironment.noPackages",
                )}
              </p>
            ) : packages ? (
              <table className="nb-environment-package-table">
                <thead>
                  <tr>
                    <th scope="col">{t("projectEnvironment.name")}</th>
                    <th scope="col">{t("projectEnvironment.version")}</th>
                  </tr>
                </thead>
                <tbody>
                  {packages.map((pkg) => (
                    <tr key={pkg.name} className="nb-package-row">
                      <td className="nb-package-name" title={pkg.name}>
                        {pkg.name}
                      </td>
                      <td>{pkg.version}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p>{unavailable}</p>
            )}
          </>
        )}
      </section>
    </aside>
  );
}
