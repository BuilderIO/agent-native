/** Resolve a supported account or API hostname to its web and Discovery URLs. */
export function dbtAccessUrls(raw?: string) {
  const input = raw?.trim() || "cloud.getdbt.com";
  const url = new URL(input.includes("://") ? input : `https://${input}`);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash
  )
    throw new Error("Enter a valid dbt Access URL.");

  const parts = url.hostname.toLowerCase().split(".");
  const apiLabel = (
    part: string | undefined,
  ): part is "metadata" | "semantic-layer" =>
    part === "metadata" || part === "semantic-layer";
  const dnsLabel = (part: string | undefined) =>
    !!part && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(part);
  const regions = new Set([
    "us1",
    "us2",
    "us3",
    "us5",
    "eu1",
    "eu2",
    "eu3",
    "eu4",
    "au1",
    "au2",
    "jp1",
  ]);

  // Regional API labels sit after the account prefix. Shared and dedicated
  // account API labels sit at the start of the hostname.
  let account: string | undefined;
  let apiLabelSeen: "metadata" | "semantic-layer" | undefined;
  let base: string;
  if (
    parts.at(-2) === "dbt" &&
    parts.at(-1) === "com" &&
    regions.has(parts.at(-3) ?? "")
  ) {
    if (
      !dnsLabel(parts[0]) ||
      (parts.length !== 4 && !(parts.length === 5 && apiLabel(parts[1])))
    )
      throw new Error("Enter a valid dbt Access URL.");
    if (parts.length === 5 && apiLabel(parts[1])) apiLabelSeen = parts[1];
    account = parts[0];
    base = parts.slice(-3).join(".");
  } else {
    if (apiLabel(parts[0]))
      apiLabelSeen = parts.shift() as "metadata" | "semantic-layer";
    base = parts.join(".");
    const shared = ["cloud.getdbt.com", "emea.dbt.com", "au.dbt.com"].includes(
      base,
    );
    const dedicated =
      parts.length === 4 &&
      parts[0] === "cloud" &&
      dnsLabel(parts[1]) &&
      parts[2] === "getdbt" &&
      parts[3] === "com";
    if (!shared && !dedicated) throw new Error("Enter a valid dbt Access URL.");
  }
  const pathname = url.pathname.replace(/\/+$/, "") || "/";
  const pathnameAllowed =
    pathname === "/" ||
    (apiLabelSeen === "metadata" && pathname === "/graphql") ||
    (apiLabelSeen === "semantic-layer" && pathname === "/api/graphql");
  if (!pathnameAllowed) throw new Error("Enter a valid dbt Access URL.");
  const webHost = account ? `${account}.${base}` : base;
  const metadataHost = account
    ? `${account}.metadata.${base}`
    : `metadata.${base}`;
  const semanticHost = account
    ? `${account}.semantic-layer.${base}`
    : `semantic-layer.${base}`;
  return {
    admin: `https://${webHost}`,
    metadata: `https://${metadataHost}/graphql`,
    semantic: `https://${semanticHost}/api/graphql`,
  };
}
