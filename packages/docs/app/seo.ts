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

export function withDefaultSocialImage(
  meta: MetaDescriptor[],
  image = DEFAULT_SOCIAL_IMAGE,
): MetaDescriptor[] {
  return coreWithDefaultSocialImage(meta as any, image) as MetaDescriptor[];
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
