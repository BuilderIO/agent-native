/**
 * The collection a URL names.
 *
 * Pages render through the workspace's catchall route and receive the resolved
 * route as a prop, so React Router's `useParams()` has no `collectionId` on
 * `/collection/:collectionId`. Reading only the router params left a collection's
 * own page rendering the index instead: no description, no filed projects, and
 * none of its Edit collection / Add projects / Delete collection controls
 * (sprint-analytics-2#515, #516).
 */
export function collectionIdFrom(
  route: { params?: Record<string, string | undefined> } | undefined,
  routerParams: { collectionId?: string } | undefined,
): string | undefined {
  const fromRoute = route?.params?.collectionId;
  if (fromRoute) return fromRoute;
  return routerParams?.collectionId ?? undefined;
}
