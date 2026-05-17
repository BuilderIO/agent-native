export type PrefetchSnapshot<T> = {
  data: T;
  syncVersion: number;
};

export const sqlDashboardPrefetchKey = (id: string) =>
  ["data", "sql-dashboard-prefetch", id] as const;

export const analysisDetailPrefetchKey = (id: string) =>
  ["analysis-detail-prefetch", id] as const;
