import { useLoaderData } from "react-router";

import { BuiltInFeatures } from "../components/website-redesign/built-in-features";
import { FeaturesActions } from "../components/website-redesign/features-actions";
import { Hero } from "../components/website-redesign/hero";
import { SiteHeader } from "../components/website-redesign/site-header";
import { WorksWithStack } from "../components/website-redesign/works-with-stack";

import tokensCss from "../components/website-redesign/tokens.css?url";

export const links = () => [{ rel: "stylesheet", href: tokensCss }];

export const meta = () => [
  { title: "Agent-Native — Homepage Preview" },
  { name: "robots", content: "noindex,nofollow" },
];

export async function loader() {
  let starCount: number | null = null;
  try {
    const res = await fetch(
      "https://api.github.com/repos/BuilderIO/agent-native",
      {
        headers: { Accept: "application/vnd.github+json" },
      },
    );
    if (res.ok) {
      const data = await res.json();
      if (typeof data.stargazers_count === "number") {
        starCount = data.stargazers_count;
      }
    }
  } catch {
    // Network/API failures surface as an explicit "unavailable" (null), not a
    // fake 0 or hardcoded fallback — the header omits the number in this case.
  }
  return { starCount };
}

export default function WebsiteRedesignHomepage() {
  const { starCount } = useLoaderData<typeof loader>();

  return (
    <div className="builder-brand-tokens" style={{ minHeight: "100vh" }}>
      <SiteHeader starCount={starCount} />
      <Hero />
      <FeaturesActions />
      <BuiltInFeatures />
      <WorksWithStack />
    </div>
  );
}
