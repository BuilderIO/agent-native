export const CHART_REPLACEMENT_SQL =
  "select date '2025-10-30' as day, 700 as amount, 'direct' as channel";

export const CHART_CAP_SQL =
  "select date '1990-01-01' + n::integer as day, 1::double precision as amount, 'direct' as channel from generate_series(1,10001) as groups(n)";
