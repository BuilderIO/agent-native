import TrustPage from "../components/TrustPage";
import enUS from "../i18n/en-US";
import { withDefaultSocialImage } from "../seo";

export const meta = () =>
  withDefaultSocialImage([
    { title: enUS.legal.about.title },
    { name: "description", content: enUS.legal.about.intro },
  ]);

export default function AboutPage() {
  return <TrustPage kind="about" />;
}
