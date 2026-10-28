import { trackEvent } from "@agent-native/core/client/analytics";
import { useT, useLocale } from "@agent-native/core/client/i18n";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";

import {
  ARTICLES_BASE,
  USE_CASES_BASE,
  CATEGORY_NAMES,
  type UseCase,
} from "../../../lib/campaign-content";
import { sitePathForLocale } from "../docs-locale";
import { TemplateLandingShell } from "../template-landing";
import { ContentCard } from "../website-redesign/ds/content-card";
import { FormSelect } from "../website-redesign/ds/form-select";
import { SectionHeader } from "../website-redesign/ds/section-header";

const roleFilters = [
  ["", "campaign.filterAll"],
  ["engineering", "campaign.filterEngineering"],
  ["product", "campaign.filterProduct"],
  ["design", "campaign.filterDesign"],
  ["marketing", "campaign.filterMarketing"],
  ["revops", "campaign.filterRevops"],
  ["sales", "campaign.filterSales"],
  ["founders", "campaign.filterFounders"],
  ["finance", "campaign.filterFinance"],
] as const;

// A card on the index: the page's headline and the hero's opening.
export type UseCaseIndexItem = Pick<
  UseCase,
  "slug" | "app" | "title" | "roles"
> & {
  subhead: string;
};

export function UseCasesIndex({ items }: { items: UseCaseIndexItem[] }) {
  const t = useT();
  const { locale } = useLocale();
  const [searchParams, setSearchParams] = useSearchParams();
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);

  const role =
    roleFilters.find(([value]) => value === searchParams.get("role"))?.[0] ??
    "";
  const matches = (item: UseCaseIndexItem) =>
    !hydrated ||
    !role ||
    item.roles?.includes("everyone") ||
    item.roles?.some((candidate) => candidate === role);
  const clearParams = new URLSearchParams(searchParams);
  clearParams.delete("role");
  function changeRole(nextRole: string) {
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      if (nextRole) next.set("role", nextRole);
      else next.delete("role");
      return next;
    });
    trackEvent("index_filter", { role: nextRole });
  }
  const apps = [...new Set(items.map((item) => item.app))];
  const [beforeArticles, afterArticles] = t("campaign.useCasesIntro", {
    articles: "<articles>",
  }).split("<articles>");
  return (
    <TemplateLandingShell className="builder-brand-tokens campaign-page pb-16">
      <div className="campaign-section border-x border-[var(--docs-border)]">
        <SectionHeader
          eyebrow={t("campaign.useCases")}
          as="h1"
          heading={t("campaign.useCasesTitle")}
          subheading={
            <>
              {beforeArticles}
              <Link
                to={sitePathForLocale(ARTICLES_BASE, locale)}
                className="campaign-inline-link text-[var(--docs-accent)]"
              >
                {t("campaign.articlesLink")}
              </Link>
              {afterArticles}
            </>
          }
        />
        <div className="mt-6 flex min-w-0 flex-wrap gap-6">
          <FormSelect
            label={t("campaign.filterRole")}
            options={roleFilters.map(([value, key]) => ({
              value,
              label: t(key),
            }))}
            value={role}
            onChange={changeRole}
          />
        </div>
      </div>
      {hydrated && !items.some(matches) ? (
        <div className="space-y-3 border-x border-b border-[var(--docs-border)] p-6 sm:p-8">
          <p className="m-0" role="status">
            {t("campaign.filterEmpty")}
          </p>
          <Link
            to={`?${clearParams.toString()}`}
            className="campaign-inline-link text-[var(--docs-accent)]"
            onClick={() => trackEvent("index_filter", { role: "" })}
          >
            {t("campaign.filterClear")}
          </Link>
        </div>
      ) : null}
      {apps.map((app) => (
        <section
          key={app}
          hidden={!items.some((item) => item.app === app && matches(item))}
          className="border border-[var(--docs-border)]"
        >
          <div className="campaign-section">
            <SectionHeader heading={CATEGORY_NAMES[app]} />
          </div>
          <div className="grid gap-px bg-[var(--docs-border)] sm:grid-cols-2 lg:grid-cols-3">
            {items
              .filter((item) => item.app === app)
              .map((item) => (
                <div
                  key={item.slug}
                  hidden={!matches(item)}
                  className="min-w-0"
                >
                  <ContentCard
                    href={sitePathForLocale(
                      `${USE_CASES_BASE}/${item.slug}`,
                      locale,
                    )}
                    title={item.title}
                    body={item.subhead}
                  />
                </div>
              ))}
          </div>
        </section>
      ))}
    </TemplateLandingShell>
  );
}
