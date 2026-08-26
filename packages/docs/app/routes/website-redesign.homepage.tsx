import { useLoaderData } from "react-router";

import { getGithubStarCount } from "../../lib/github-star-count";
import { BottomCta } from "../components/website-redesign/bottom-cta";
import { BuiltInFeatures } from "../components/website-redesign/built-in-features";
import { SnackbarProvider } from "../components/website-redesign/ds/snackbar";
import { FeaturesActions } from "../components/website-redesign/features-actions";
import { Footer } from "../components/website-redesign/footer";
import { Hero } from "../components/website-redesign/hero";
import { SiteHeader } from "../components/website-redesign/site-header";
import { TemplateShowcase } from "../components/website-redesign/template-showcase";
import { WorksWithStack } from "../components/website-redesign/works-with-stack";

import tokensCss from "../components/website-redesign/tokens.css?url";

export const links = () => [{ rel: "stylesheet", href: tokensCss }];

export const meta = () => [
  { title: "Agent-Native — Homepage Preview" },
  { name: "robots", content: "noindex,nofollow" },
];

export async function loader() {
  const starCount = await getGithubStarCount();
  return { starCount };
}

export default function WebsiteRedesignHomepage() {
  const { starCount } = useLoaderData<typeof loader>();

  return (
    <div className="builder-brand-tokens" style={{ minHeight: "100vh" }}>
      {/* Inside the token scope, not around it: the snackbar is styled with
          --b-* variables that only resolve under .builder-brand-tokens. */}
      <SnackbarProvider>
        <SiteHeader starCount={starCount} />
        <Hero />
        <FeaturesActions />
        <BuiltInFeatures />
        <WorksWithStack />
        <TemplateShowcase />
        <BottomCta />
        <Footer />
      </SnackbarProvider>
    </div>
  );
}
