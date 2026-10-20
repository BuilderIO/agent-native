// Netlify Functions run in a fixed set of AWS regions. This is that set, not
// every AWS region Neon can host a database in — a Neon host outside it has
// nowhere safe to place functions, which must return the same "no placement"
// signal as a non-Neon host or a garbage URL, not a guessed default region.
const NETLIFY_FUNCTIONS_REGIONS = new Set([
  "us-east-1",
  "us-east-2",
  "us-west-2",
  "eu-central-1",
  "eu-west-2",
  "ap-southeast-1",
  "ap-southeast-2",
  "ap-northeast-1",
  "sa-east-1",
  "ca-central-1",
  "ap-south-1",
]);

const NEON_AWS_HOST_SUFFIX = ".aws.neon.tech";

/**
 * Returns the AWS region a Neon Postgres host runs in, or null when the URL
 * is not a Neon-on-AWS host, is unparseable, or names a region Netlify
 * Functions does not run in. Covers both pooler and direct endpoint
 * hostnames, e.g. `ep-x-pooler.us-east-1.aws.neon.tech` and
 * `ep-x.c-2.us-east-1.aws.neon.tech` (the `c-2` compute id segment).
 */
export function parseNeonDatabaseRegion(databaseUrl: string): string | null {
  if (!databaseUrl) return null;

  let host: string;
  try {
    host = new URL(databaseUrl).hostname;
  } catch {
    // coercion-ok: an unparseable URL has no region; null tells the caller to leave the functions region unchanged.
    return null;
  }
  if (!host || !host.toLowerCase().endsWith(NEON_AWS_HOST_SUFFIX)) {
    return null;
  }

  const segments = host
    .slice(0, -NEON_AWS_HOST_SUFFIX.length)
    .split(".")
    .filter(Boolean);
  const region = segments.at(-1)?.toLowerCase();
  return region && NETLIFY_FUNCTIONS_REGIONS.has(region) ? region : null;
}
