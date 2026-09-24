import { appPath } from "@agent-native/core/client/api-path";
import { MarketingHome } from "@agent-native/toolkit/marketing";

const SEO_TITLE =
  "Assets - Open Source AI asset library for brand-safe images and video";
const SEO_DESCRIPTION =
  "Open Source asset manager for AI teams to organize brand libraries, search creative work, and generate on-brand images and videos.";

export function meta() {
  return [
    { title: SEO_TITLE },
    { name: "description", content: SEO_DESCRIPTION },
    { property: "og:title", content: SEO_TITLE },
    { property: "og:description", content: SEO_DESCRIPTION },
    { name: "twitter:card", content: "summary" },
    { name: "twitter:title", content: SEO_TITLE },
    { name: "twitter:description", content: SEO_DESCRIPTION },
  ];
}

export default function MarketingHomeRoute() {
  return (
    <MarketingHome
      appName="Assets"
      tagline="Your AI agent creates, refines, and organizes on-brand assets alongside you."
      description={SEO_DESCRIPTION}
      valueProps={[
        "Build reusable libraries from logos, product shots, videos, and references",
        "Generate heroes, diagrams, product visuals, and videos from a prompt",
        "Audit prompts, references, outputs, and refinements across every run",
      ]}
      primaryActionHref={appPath("/home")}
      secondaryActionHref={appPath("/sign-in")}
    />
  );
}
