import { communityApps } from "../components/community-apps";
import { templates } from "../components/TemplateCard";

export async function loader() {
  const apps = [
    ...templates.map((app) => ({
      id: app.slug,
      name: app.name,
      description: `Agent-Native ${app.name} app`,
      url: app.demoUrl,
      capabilities: [],
      source: "first-party" as const,
    })),
    ...communityApps
      .filter((app) => app.demoUrl)
      .map((app) => ({
        id: app.slug,
        name: app.name,
        description: app.description,
        url: app.demoUrl!,
        capabilities: [],
        source: "community" as const,
      })),
  ];
  return new Response(JSON.stringify({ version: 1, apps }), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=300, s-maxage=3600",
      "access-control-allow-origin": "*",
    },
  });
}
