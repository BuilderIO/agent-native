import type {
  DashboardFilter,
  SqlPanel,
} from "@agent-native/toolkit/dashboard/sql-dashboard-types";
import {
  ALL_TRAFFIC,
  isTrafficFilterValue,
  mayReadTrafficScopedTables,
  readTrafficEnvironment,
  TRAFFIC_FILTER_ID,
  TRAFFIC_FILTER_PARAM,
} from "@shared/traffic-environment";

import { serializePanelSql } from "./panel-sql";

const PLACEHOLDER_IN_WORD = /(\w*)\{\{(\w+)(?::list)?\}\}(\w*)/g;

function placeholderValues(
  name: string,
  filters: readonly DashboardFilter[],
  variables: Readonly<Record<string, string>>,
): readonly string[] {
  const filter = filters.find((f) => f.id === name && f.type !== "date-range");
  if (filter) {
    return [
      filter.default ?? "",
      ...(filter.options ?? []).map((option) => option.value),
    ];
  }
  return Object.entries(variables).flatMap(([key, value]) =>
    key === name ? [value] : [],
  );
}

function takesTypedValue(
  sql: string,
  filters: readonly DashboardFilter[],
): boolean {
  return filters.some(
    (filter) =>
      filter.type === "text" &&
      (sql.includes(`{{${filter.id}}}`) ||
        sql.includes(`{{${filter.id}:list}}`)),
  );
}

function panelMayReadTrafficTables(
  sql: string,
  filters: readonly DashboardFilter[],
  variables: Readonly<Record<string, string>>,
): boolean {
  if (takesTypedValue(sql, filters)) return true;
  return mayReadTrafficScopedTables(
    sql.replace(
      PLACEHOLDER_IN_WORD,
      (match, before: string, name: string, after: string) => {
        const values = placeholderValues(name, filters, variables);
        return values.length > 0
          ? ` ${values.map((value) => before + value + after).join(" ")} `
          : match;
      },
    ),
  );
}

export interface TrafficFilterLabels {
  label: string;
  all: string;
  production: string;
  beta: string;
}

/**
 * The filters a dashboard shows. Traffic only means something over first-party
 * panels, and a dashboard saved before the filter existed keeps reading all
 * traffic. Saved labels are English, so they're replaced for the reader.
 */
export function dashboardFiltersWithTraffic(
  filters: readonly DashboardFilter[] | undefined,
  panels: readonly SqlPanel[],
  labels: TrafficFilterLabels,
  variables: Readonly<Record<string, string>> = {},
): DashboardFilter[] {
  const others = (filters ?? []).filter((f) => f.id !== TRAFFIC_FILTER_ID);
  if (
    !panels.some(
      (panel) =>
        panel.source === "first-party" &&
        panelMayReadTrafficTables(
          serializePanelSql(panel.sql),
          filters ?? [],
          variables,
        ),
    )
  ) {
    return others;
  }
  const saved = filters?.find((f) => f.id === TRAFFIC_FILTER_ID);
  return [
    ...others,
    {
      id: TRAFFIC_FILTER_ID,
      label: labels.label,
      type: "select",
      default: saved?.default ?? ALL_TRAFFIC,
      options: [
        { value: ALL_TRAFFIC, label: labels.all },
        { value: "production", label: labels.production },
        { value: "beta", label: labels.beta },
      ],
    },
  ];
}

/**
 * The report filters for what's on screen. A report saved without a traffic
 * filter reads all traffic, so "all" only needs saying where the dashboard's
 * own default is something else.
 */
export function reportFiltersWithTraffic(
  reportFilters: Record<string, string>,
  shownFilters: readonly DashboardFilter[],
  vars: Record<string, string>,
): Record<string, string> {
  const { [TRAFFIC_FILTER_PARAM]: _fromUrl, ...others } = reportFilters;
  const filter = shownFilters.find((f) => f.id === TRAFFIC_FILTER_ID);
  if (!filter) return others;
  const value = vars[TRAFFIC_FILTER_ID] ?? ALL_TRAFFIC;
  return value === ALL_TRAFFIC && filter.default === ALL_TRAFFIC
    ? others
    : { ...others, [TRAFFIC_FILTER_PARAM]: value };
}

/**
 * The page's filter values, with a traffic value the filter doesn't offer, such
 * as a stale link's, replaced by the dashboard's default. Read as given, it
 * would mean all traffic.
 */
export function withOfferedTraffic(
  vars: Record<string, string>,
  shownFilters: readonly DashboardFilter[],
): Record<string, string> {
  const filter = shownFilters.find((f) => f.id === TRAFFIC_FILTER_ID);
  const value = vars[TRAFFIC_FILTER_ID] ?? ALL_TRAFFIC;
  if (!filter || isTrafficFilterValue(value)) return vars;
  return { ...vars, [TRAFFIC_FILTER_ID]: filter.default ?? ALL_TRAFFIC };
}

export function dashboardTrafficEnvironment(vars: Record<string, string>) {
  return readTrafficEnvironment(vars[TRAFFIC_FILTER_ID]);
}
