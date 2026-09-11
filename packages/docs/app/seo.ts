import {
  AGENT_NATIVE_DEFAULT_SOCIAL_IMAGE,
  AGENT_NATIVE_SOCIAL_IMAGE_PATH,
  defaultSocialImageMeta as coreDefaultSocialImageMeta,
  withAgentNativeSocialImageCacheBuster,
  withDefaultSocialImage as coreWithDefaultSocialImage,
} from "@agent-native/core/shared";
import type { MetaDescriptor } from "react-router";

const SITE_URL = "https://www.agent-native.com";
const DOCS_SOCIAL_IMAGE_ACCENT = "Agent-Native Docs";

export const DEFAULT_SOCIAL_IMAGE = AGENT_NATIVE_DEFAULT_SOCIAL_IMAGE;

export function agentNativeSocialImageUrl(
  title: string,
  accentText?: string,
): string {
  const url = new URL(
    withAgentNativeSocialImageCacheBuster(AGENT_NATIVE_SOCIAL_IMAGE_PATH),
    SITE_URL,
  );
  url.searchParams.set("title", title);
  if (accentText) {
    url.searchParams.set("accentText", accentText);
  }
  return url.toString();
}

export function defaultSocialImageMeta(): MetaDescriptor[] {
  return coreDefaultSocialImageMeta() as MetaDescriptor[];
}

function hasMetaProperty(meta: MetaDescriptor[], property: string): boolean {
  return meta.some((item) => "property" in item && item.property === property);
}

function titleFrom(meta: MetaDescriptor[]): string | undefined {
  const entry = meta.find((item) => "title" in item);
  return entry && "title" in entry ? (entry.title as string) : undefined;
}

function descriptionFrom(meta: MetaDescriptor[]): string | undefined {
  const entry = meta.find(
    (item) => "name" in item && item.name === "description",
  );
  return entry && "content" in entry ? (entry.content as string) : undefined;
}

/**
 * Every route's `meta()` replaces its parents' instead of merging with them,
 * so a page that only sets `title`/`description` (the HTML tag and search
 * snippet) silently ships with no og:title/og:description/og:type — this is
 * what Ahrefs flagged as "Open Graph tags incomplete" and "X card
 * incomplete" across about/contact/download/pricing/privacy/terms and the
 * template & app detail pages. Backfill the Open Graph equivalents from the
 * plain title/description here, once, instead of at each call site.
 */
export function withDefaultSocialImage(
  meta: MetaDescriptor[],
  image = DEFAULT_SOCIAL_IMAGE,
): MetaDescriptor[] {
  const withOgText: MetaDescriptor[] = [...meta];

  if (!hasMetaProperty(meta, "og:title")) {
    const title = titleFrom(meta);
    if (title) withOgText.push({ property: "og:title", content: title });
  }

  if (!hasMetaProperty(meta, "og:description")) {
    const description = descriptionFrom(meta);
    if (description) {
      withOgText.push({ property: "og:description", content: description });
    }
  }

  if (!hasMetaProperty(meta, "og:type")) {
    withOgText.push({ property: "og:type", content: "website" });
  }

  return coreWithDefaultSocialImage(
    withOgText as any,
    image,
  ) as MetaDescriptor[];
}

export function withTemplateSocialImage(
  meta: MetaDescriptor[],
  templateName: string,
): MetaDescriptor[] {
  return withDefaultSocialImage(
    meta,
    agentNativeSocialImageUrl(`Agent-Native ${templateName}`),
  );
}

export function withDocsSocialImage(
  meta: MetaDescriptor[],
  docTitle: string,
): MetaDescriptor[] {
  return withDefaultSocialImage(
    meta,
    agentNativeSocialImageUrl(docTitle, DOCS_SOCIAL_IMAGE_ACCENT),
  );
}
