export function slugifyProjectName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s/-]/g, "")
    .replace(/[\s/]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export function normalizeBuilderBlogHandle(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";

  const withoutOrigin = trimmed.replace(/^https?:\/\/[^/]+/i, "");
  const withoutBlogPrefix = withoutOrigin.replace(/^\/blog\//i, "");
  return withoutBlogPrefix.replace(/^\/+|\/+$/g, "");
}

export function getBuilderBlogProjectSlug(input: string): string {
  const normalizedHandle = normalizeBuilderBlogHandle(input);
  if (!normalizedHandle) return "";

  return slugifyProjectName(normalizedHandle);
}
