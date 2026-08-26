import { BottomCta } from "../components/website-redesign/bottom-cta";
import { BuiltInFeatures } from "../components/website-redesign/built-in-features";
import { SnackbarProvider } from "../components/website-redesign/ds/snackbar";
import { FeaturesActions } from "../components/website-redesign/features-actions";
import { Footer } from "../components/website-redesign/footer";
import { Hero } from "../components/website-redesign/hero";
import { TemplateShowcase } from "../components/website-redesign/template-showcase";
import { WorksWithStack } from "../components/website-redesign/works-with-stack";

export const meta = () => [
  { title: "Agent-Native — Homepage Preview" },
  { name: "robots", content: "noindex,nofollow" },
];

export default function WebsiteRedesignHomepage() {
  return (
    <div className="builder-brand-tokens" style={{ minHeight: "100vh" }}>
      {/* Inside the token scope, not around it: the snackbar is styled with
          --b-* variables that only resolve under .builder-brand-tokens. */}
      <SnackbarProvider>
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
