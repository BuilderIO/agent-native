export function buildCampaignCtaUrl(
  appUrl: string,
  jobId: string,
  incomingSearch: string,
): string {
  const url = new URL(appUrl);
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password
  ) {
    throw new Error("Campaign CTA requires a safe HTTP(S) app URL");
  }
  const incoming = new URLSearchParams(incomingSearch);
  const trackingKeys = new Set(
    [...incoming.keys()].filter(
      (key) =>
        key.startsWith("utm_") || ["gclid", "msclkid", "fbclid"].includes(key),
    ),
  );
  for (const key of trackingKeys) {
    url.searchParams.delete(key);
    for (const value of incoming.getAll(key))
      url.searchParams.append(key, value);
  }
  url.searchParams.set("job", jobId);
  if (!incoming.has("utm_content") && !url.searchParams.has("utm_content")) {
    url.searchParams.set("utm_content", jobId);
  }
  return url.toString();
}
