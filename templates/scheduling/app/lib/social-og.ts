import type { MetaDescriptor } from "react-router";
import {
  AGENT_NATIVE_SOCIAL_IMAGE_ALT,
  AGENT_NATIVE_SOCIAL_IMAGE_HEIGHT,
  AGENT_NATIVE_SOCIAL_IMAGE_PATH,
  AGENT_NATIVE_SOCIAL_IMAGE_TYPE,
  AGENT_NATIVE_SOCIAL_IMAGE_WIDTH,
} from "@agent-native/core/shared";

function normalizeAppBasePath(value: string | undefined): string {
  if (!value || value === "/") return "";
  const trimmed = value.trim();
  if (!trimmed || trimmed === "/") return "";
  return `/${trimmed.replace(/^\/+/, "").replace(/\/+$/, "")}`;
}

function appBasePath(): string {
  const metaEnv = (
    import.meta as unknown as {
      env?: Record<string, string | undefined>;
    }
  ).env;
  return normalizeAppBasePath(
    process.env.VITE_APP_BASE_PATH ||
      process.env.APP_BASE_PATH ||
      metaEnv?.VITE_APP_BASE_PATH ||
      metaEnv?.APP_BASE_PATH ||
      metaEnv?.BASE_URL,
  );
}

export function buildSocialOgImageUrl({
  request,
  title,
  subtitle,
}: {
  request: Request;
  title: string;
  subtitle: string;
}): string {
  const imageUrl = new URL(
    `${appBasePath()}${AGENT_NATIVE_SOCIAL_IMAGE_PATH}`,
    request.url,
  );
  imageUrl.searchParams.set("title", title);
  imageUrl.searchParams.set("subtitle", subtitle);
  return imageUrl.toString();
}

export function socialImageMeta(
  image: string,
  alt = AGENT_NATIVE_SOCIAL_IMAGE_ALT,
): MetaDescriptor[] {
  return [
    { property: "og:image", content: image },
    { property: "og:image:secure_url", content: image },
    { property: "og:image:type", content: AGENT_NATIVE_SOCIAL_IMAGE_TYPE },
    { property: "og:image:width", content: AGENT_NATIVE_SOCIAL_IMAGE_WIDTH },
    { property: "og:image:height", content: AGENT_NATIVE_SOCIAL_IMAGE_HEIGHT },
    { property: "og:image:alt", content: alt },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:image", content: image },
    { name: "twitter:image:alt", content: alt },
  ];
}
