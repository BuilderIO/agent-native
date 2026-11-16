const NONPUBLIC_SUFFIXES = [
  ".local",
  ".localhost",
  ".internal",
  ".intranet",
  ".lan",
  ".home",
  ".corp",
  ".home.arpa",
];

/**
 * Whether a hostname can only name a machine on a private network, judged by
 * name alone: single-label hosts, IP literals, and local-only suffixes. Pages
 * that a viewer's browser loads directly skip the server's SSRF-safe fetch, so
 * a server path should also reject a name that resolves privately in DNS.
 */
export function isNonPublicHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return (
    !host.includes(".") ||
    /^[\d.]+$/.test(host) ||
    host.includes(":") ||
    NONPUBLIC_SUFFIXES.some((suffix) => host.endsWith(suffix))
  );
}
