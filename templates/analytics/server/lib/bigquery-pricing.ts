/** BigQuery on-demand list price, US multi-region. */
export const ON_DEMAND_USD_PER_TIB = 6.25;
/** BigQuery bills in binary units: one TiB is 2^40 bytes. */
export const BYTES_PER_TIB = 1024 ** 4;
/** On-demand bills at least 10 MiB for any query that reads data. */
export const MIN_BILLED_BYTES_PER_QUERY = 10 * 1024 ** 2;

/** List-price dollars for billed bytes, with no minimum applied. */
export function usdForBilledBytes(bytes: number): number {
  return (bytes / BYTES_PER_TIB) * ON_DEMAND_USD_PER_TIB;
}

/** The most bytes that bill no more than `usd`. */
export function billedBytesForUsd(usd: number): number {
  return Math.floor((usd * BYTES_PER_TIB) / ON_DEMAND_USD_PER_TIB);
}
