import { BottomCta } from "../components/website-redesign/bottom-cta";
import { BuiltInFeatures } from "../components/website-redesign/built-in-features";
import { FeaturesActions } from "../components/website-redesign/features-actions";
import { Hero } from "../components/website-redesign/hero";
import { TemplateShowcase } from "../components/website-redesign/template-showcase";
import { WorksWithStack } from "../components/website-redesign/works-with-stack";

export default function Home() {
  return (
    <div className="builder-brand-tokens min-h-screen">
      <Hero />
      <FeaturesActions />
      <BuiltInFeatures />
      <WorksWithStack />
      <TemplateShowcase />
      <BottomCta />
    </div>
  );
}
