import LegalPolicyPage from "../components/LegalPolicyPage";
import privacyMarkdown from "../legal-policies/privacy.md?raw";
import { withDefaultSocialImage } from "../seo";

export const meta = () =>
  withDefaultSocialImage([
    {
      title: "Agent-Native Privacy Policy",
    },
    {
      name: "description",
      content:
        "Standalone privacy policy for Agent-Native hosted applications and related services.",
    },
  ]);

export default function PrivacyPage() {
  return <LegalPolicyPage markdown={privacyMarkdown} />;
}
