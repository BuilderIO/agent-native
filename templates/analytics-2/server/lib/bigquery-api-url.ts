const BIGQUERY_API_PATH_PREFIXES = [
  "/bigquery",
  "/bigquerystorage",
  "/bigqueryconnection",
  "/bigquerydatatransfer",
  "/bigquerymigration",
  "/bigqueryreservation",
  "/bigquerydatapolicy",
];
const LEGACY_BIGQUERY_BATCH_PATH = "/batch/bigquery/v2";
const LEGACY_GOOGLE_API_BATCH_HOSTS = new Set([
  "www.googleapis.com",
  "content.googleapis.com",
  "clients6.google.com",
]);

export type BigQueryApiUrlClassification = "bigquery" | "other" | "invalid";

function classifyLegacyBigQueryBatchPath(
  hostname: string,
  pathname: string,
): BigQueryApiUrlClassification {
  if (!LEGACY_GOOGLE_API_BATCH_HOSTS.has(hostname)) return "other";

  const pathSegments: string[] = [];
  let hasInvalidEncoding = false;
  for (const segment of pathname.split("/").filter(Boolean)) {
    try {
      pathSegments.push(
        ...decodeURIComponent(segment).split("/").filter(Boolean),
      );
    } catch {
      hasInvalidEncoding = true;
      pathSegments.push(segment);
    }

    if (pathSegments.length >= 3) {
      const batchPath = `/${pathSegments.slice(0, 3).join("/")}`.toLowerCase();
      if (batchPath === LEGACY_BIGQUERY_BATCH_PATH) return "bigquery";
      return hasInvalidEncoding ? "invalid" : "other";
    }
  }

  return hasInvalidEncoding ? "invalid" : "other";
}

function classifyBigQueryApiPathPrefix(
  pathname: string,
): BigQueryApiUrlClassification {
  const firstSegment = pathname.split("/").find(Boolean);
  if (!firstSegment) return "other";

  try {
    const decodedFirstPathPart = decodeURIComponent(firstSegment)
      .replaceAll("\\", "/")
      .split("/", 1)[0]!
      .toLowerCase();
    return BIGQUERY_API_PATH_PREFIXES.some(
      (prefix) => prefix.slice(1) === decodedFirstPathPart,
    )
      ? "bigquery"
      : "other";
  } catch {
    return "invalid";
  }
}

export function classifyBigQueryApiUrl(
  path: string,
): BigQueryApiUrlClassification {
  const normalizedPath = path.trim();
  if (!/^https?:\/\//i.test(normalizedPath)) return "other";

  let url: URL;
  try {
    url = new URL(normalizedPath);
  } catch {
    return "invalid";
  }

  const hostname = url.hostname.replace(/\.$/, "").toLowerCase();
  const hostnameLabels = hostname.split(".");
  if (
    hostnameLabels.at(-2) === "googleapis" &&
    hostnameLabels.slice(0, -2).some((label) => label.startsWith("bigquery"))
  ) {
    return "bigquery";
  }

  const legacyBatchClassification = classifyLegacyBigQueryBatchPath(
    hostname,
    url.pathname,
  );
  if (legacyBatchClassification !== "other") {
    return legacyBatchClassification;
  }

  if (hostname !== "googleapis.com" && !hostname.endsWith(".googleapis.com")) {
    return "other";
  }

  return classifyBigQueryApiPathPrefix(url.pathname);
}
