import { BottomCta } from "../components/website-redesign/bottom-cta";
import { BuiltInFeatures } from "../components/website-redesign/built-in-features";
import { SnackbarProvider } from "../components/website-redesign/ds/snackbar";
import { FeaturesActions } from "../components/website-redesign/features-actions";
import { Hero } from "../components/website-redesign/hero";
import { TemplateShowcase } from "../components/website-redesign/template-showcase";
import { WorksWithStack } from "../components/website-redesign/works-with-stack";

export default function Home() {
  return (
    <div className="builder-brand-tokens min-h-screen">
      {/* Inside the token scope, not around it: the snackbar is styled with
          --b-* variables that only resolve under .builder-brand-tokens. */}
      <SnackbarProvider>
        <Hero />
        <FeaturesActions />
        <BuiltInFeatures />
        <WorksWithStack />
        <TemplateShowcase />
        <BottomCta />
      </SnackbarProvider>
    </div>
  );
}
