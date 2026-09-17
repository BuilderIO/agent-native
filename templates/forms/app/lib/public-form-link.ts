import { appPath } from "@agent-native/core/client/api-path";

interface PublicFormLink {
  status: string;
  slug: string;
}

export function getPublishedFormUrl(
  form: PublicFormLink,
  origin: string,
): string | undefined {
  if (form.status !== "published") return undefined;
  return `${origin}${appPath(`/f/${form.slug}`)}`;
}
