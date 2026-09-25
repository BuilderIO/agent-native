export function planReturnPathFromLocation(location: {
  pathname: string;
  search: string;
  hash: string;
}): string {
  const safeHash = location.hash.startsWith("#bridge=") ? "" : location.hash;
  return `${location.pathname}${location.search}${safeHash}`;
}
