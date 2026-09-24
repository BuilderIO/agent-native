export function isBuilderEditorUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      (url.hostname === "builder.io" || url.hostname.endsWith(".builder.io")) &&
      !url.username &&
      !url.password &&
      !url.port &&
      /^\/app\/projects\/[^/]+\/[^/]+\/?$/.test(url.pathname)
    );
  } catch {
    return false;
  }
}
