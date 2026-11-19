export const ON_DEMAND_USD_PER_TIB = 6.25;
export const BYTES_PER_TIB = 1024 ** 4;
export const MIN_BILLED_BYTES_PER_QUERY = 10 * 1024 ** 2;

export function usdForBilledBytes(bytes: number): number {
  return (bytes / BYTES_PER_TIB) * ON_DEMAND_USD_PER_TIB;
}

export function billedBytesForUsd(usd: number): number {
  return Math.floor((usd * BYTES_PER_TIB) / ON_DEMAND_USD_PER_TIB);
}
