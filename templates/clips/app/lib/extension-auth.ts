export function buildClipsExtensionBaseUrl(
  origin: string,
  appRootPath: string,
): string {
  const url = new URL(appRootPath, origin);
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/+$/, "");
}
