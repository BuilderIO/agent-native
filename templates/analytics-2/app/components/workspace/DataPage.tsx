import { DataPageAdapter } from "./DataPageAdapter";
import type { RoutePageProps } from "./types";

/**
 * Home → Data. The route segment selects the tab; the detail params select a
 * connection or node. All action and permission wiring lives in the adapter.
 */
export function DataPage({ route }: RoutePageProps) {
  return <DataPageAdapter route={route} />;
}
