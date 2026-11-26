export async function loadDesignReferenceCopy(args: {
  bridgeUrl: string;
  previewToken: string;
  url: string;
  signal: AbortSignal;
}): Promise<{ html: string; url: string }> {
  const endpoint = new URL("/reference-copy", args.bridgeUrl);
  endpoint.searchParams.set("url", args.url);
  const response = await fetch(endpoint, {
    headers: { "x-design-preview-token": args.previewToken },
    credentials: "omit",
    signal: args.signal,
  });
  const result: unknown = await response.json();
  if (
    !response.ok ||
    !result ||
    typeof result !== "object" ||
    !("html" in result) ||
    typeof result.html !== "string" ||
    !("url" in result) ||
    typeof result.url !== "string"
  ) {
    throw new Error("Reference copy unavailable");
  }
  return { html: result.html, url: result.url };
}
