import type { MetaDescriptor } from "react-router";
import {
  AGENT_NATIVE_DEFAULT_SOCIAL_IMAGE,
  defaultSocialImageMeta as coreDefaultSocialImageMeta,
  withDefaultSocialImage as coreWithDefaultSocialImage,
} from "@agent-native/core/shared";

export const DEFAULT_SOCIAL_IMAGE = AGENT_NATIVE_DEFAULT_SOCIAL_IMAGE;

export function defaultSocialImageMeta(): MetaDescriptor[] {
  return coreDefaultSocialImageMeta() as MetaDescriptor[];
}

export function withDefaultSocialImage(
  meta: MetaDescriptor[],
): MetaDescriptor[] {
  return coreWithDefaultSocialImage(meta as any) as MetaDescriptor[];
}
