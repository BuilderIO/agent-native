import TrustPage from "../components/TrustPage";
import enUS from "../i18n/en-US";
import { withDefaultSocialImage } from "../seo";

export const meta = () =>
  withDefaultSocialImage([
    { title: enUS.legal.contact.title },
    { name: "description", content: enUS.legal.contact.intro },
  ]);

export default function ContactPage() {
  return <TrustPage kind="contact" />;
}
