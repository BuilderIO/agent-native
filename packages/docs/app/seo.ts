import type { MetaDescriptor } from "react-router";
import {
  AGENT_NATIVE_DEFAULT_SOCIAL_IMAGE,
  AGENT_NATIVE_SOCIAL_IMAGE_PATH,
  defaultSocialImageMeta as coreDefaultSocialImageMeta,
  withAgentNativeSocialImageCacheBuster,
  withDefaultSocialImage as coreWithDefaultSocialImage,
} from "@agent-native/core/shared";

const SITE_URL = "https://www.agent-native.com";

export const DEFAULT_SOCIAL_IMAGE = AGENT_NATIVE_DEFAULT_SOCIAL_IMAGE;

export function agentNativeSocialImageUrl(title: string): string {
  const url = new URL(
    withAgentNativeSocialImageCacheBuster(AGENT_NATIVE_SOCIAL_IMAGE_PATH),
    SITE_URL,
  );
  url.searchParams.set("title", title);
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
