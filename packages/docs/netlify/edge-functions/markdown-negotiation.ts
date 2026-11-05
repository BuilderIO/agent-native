const MARKDOWN_REWRITE_PREFIX = "/__agent-native-markdown";

export function acceptsMarkdown(header: string | null): boolean {
  return (header ?? "").split(",").some((range) => {
    const [mediaType, ...parameters] = range.split(";");
    if (mediaType?.trim().toLowerCase() !== "text/markdown") return false;
    const quality = parameters
      .map((parameter) => parameter.trim().split("=", 2))
      .find(([name]) => name?.toLowerCase() === "q")?.[1];
    return quality === undefined || Number(quality) > 0;
  });
}

function isStaticAsset(pathname: string): boolean {
  return (
    pathname.endsWith("/Dockerfile") ||
    /\.(?:avif|css|data|dockerignore|eot|example|gif|html|ico|jpe?g|js|json|map|md|png|svg|txt|ttf|wasm|webmanifest|webp|woff2?|xml|ya?ml)$/i.test(
      pathname,
    )
  );
}

export default function markdownNegotiation(request: Request): URL | undefined {
  const url = new URL(request.url);
  if (
    !acceptsMarkdown(request.headers.get("accept")) ||
    url.pathname === MARKDOWN_REWRITE_PREFIX ||
    url.pathname.startsWith(`${MARKDOWN_REWRITE_PREFIX}/`) ||
    isStaticAsset(url.pathname)
  ) {
    return undefined;
  }

  return new URL(
    `${MARKDOWN_REWRITE_PREFIX}${url.pathname}${url.search}`,
    request.url,
  );
}

export const config = {
  path: "/*",
  excludedPath: [
    "/.netlify/*",
    "/.well-known/*",
    "/_agent-native/*",
    "/__agent-native-markdown",
    "/__agent-native-markdown/*",
    "/api/*",
    "/assets/*",
    "/examples/self-hosted-chat/Dockerfile",
    "/apps/brain",
    "/apps/brain/",
    "/templates/brain",
    "/templates/brain/",
    "/:locale/apps/brain",
    "/:locale/apps/brain/",
    "/:locale/templates/brain",
    "/:locale/templates/brain/",
    "/home",
    "/home/",
    "/templates",
    "/templates/",
    "/templates/*",
    "/:locale/templates",
    "/:locale/templates/",
    "/:locale/templates/*",
    "/docs/getting-started",
    "/:locale/docs/getting-started",
    "/docs/resources",
    "/docs/workspace",
    "/:locale/docs/workspace",
    "/docs/:locale/workspace",
    // The old articles and their topic and category pages, redirected in netlify.toml.
    "/articles/can-people-and-an-ai-agent-edit-the-same-document",
    "/articles/can-people-and-an-ai-agent-edit-the-same-document/",
    "/:locale/articles/can-people-and-an-ai-agent-edit-the-same-document",
    "/:locale/articles/can-people-and-an-ai-agent-edit-the-same-document/",
    "/articles/how-do-you-add-skills-to-claude-code-and-codex",
    "/articles/how-do-you-add-skills-to-claude-code-and-codex/",
    "/:locale/articles/how-do-you-add-skills-to-claude-code-and-codex",
    "/:locale/articles/how-do-you-add-skills-to-claude-code-and-codex/",
    "/articles/how-do-you-build-a-landing-page-with-ai",
    "/articles/how-do-you-build-a-landing-page-with-ai/",
    "/:locale/articles/how-do-you-build-a-landing-page-with-ai",
    "/:locale/articles/how-do-you-build-a-landing-page-with-ai/",
    "/articles/how-to-make-a-pitch-deck-with-ai",
    "/articles/how-to-make-a-pitch-deck-with-ai/",
    "/:locale/articles/how-to-make-a-pitch-deck-with-ai",
    "/:locale/articles/how-to-make-a-pitch-deck-with-ai/",
    "/articles/how-to-turn-a-design-brief-into-a-prototype-with-ai",
    "/articles/how-to-turn-a-design-brief-into-a-prototype-with-ai/",
    "/:locale/articles/how-to-turn-a-design-brief-into-a-prototype-with-ai",
    "/:locale/articles/how-to-turn-a-design-brief-into-a-prototype-with-ai/",
    "/articles/how-to-use-ai-to-take-meeting-notes",
    "/articles/how-to-use-ai-to-take-meeting-notes/",
    "/:locale/articles/how-to-use-ai-to-take-meeting-notes",
    "/:locale/articles/how-to-use-ai-to-take-meeting-notes/",
    "/articles/how-to-write-a-bug-report",
    "/articles/how-to-write-a-bug-report/",
    "/:locale/articles/how-to-write-a-bug-report",
    "/:locale/articles/how-to-write-a-bug-report/",
    "/articles/what-goes-in-a-technical-design-document",
    "/articles/what-goes-in-a-technical-design-document/",
    "/:locale/articles/what-goes-in-a-technical-design-document",
    "/:locale/articles/what-goes-in-a-technical-design-document/",
    "/articles/what-is-an-agent-native-app",
    "/articles/what-is-an-agent-native-app/",
    "/:locale/articles/what-is-an-agent-native-app",
    "/:locale/articles/what-is-an-agent-native-app/",
    "/articles/what-should-a-saas-metrics-dashboard-include",
    "/articles/what-should-a-saas-metrics-dashboard-include/",
    "/:locale/articles/what-should-a-saas-metrics-dashboard-include",
    "/:locale/articles/what-should-a-saas-metrics-dashboard-include/",
    "/articles/what-should-you-look-for-in-dictation-software",
    "/articles/what-should-you-look-for-in-dictation-software/",
    "/:locale/articles/what-should-you-look-for-in-dictation-software",
    "/:locale/articles/what-should-you-look-for-in-dictation-software/",
    "/articles/topic/*",
    "/:locale/articles/topic/*",
    "/articles/category/*",
    "/:locale/articles/category/*",
  ],
};
