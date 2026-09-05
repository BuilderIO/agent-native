import acceptableUseMarkdown from "./legal-policies/acceptable-use.md?raw";
import aiTermsMarkdown from "./legal-policies/ai-terms.md?raw";
import lawEnforcementMarkdown from "./legal-policies/law-enforcement.md?raw";
import platformRulesMarkdown from "./legal-policies/platform-rules.md?raw";
import privacyMarkdown from "./legal-policies/privacy.md?raw";
import takedownMarkdown from "./legal-policies/takedown.md?raw";
import termsMarkdown from "./legal-policies/terms.md?raw";
import { LEGAL_POLICY_METADATA } from "./legal-policy-list";

export const LEGAL_POLICIES = [
  { ...LEGAL_POLICY_METADATA[0], markdown: termsMarkdown },
  { ...LEGAL_POLICY_METADATA[1], markdown: privacyMarkdown },
  { ...LEGAL_POLICY_METADATA[2], markdown: acceptableUseMarkdown },
  { ...LEGAL_POLICY_METADATA[3], markdown: aiTermsMarkdown },
  { ...LEGAL_POLICY_METADATA[4], markdown: platformRulesMarkdown },
  { ...LEGAL_POLICY_METADATA[5], markdown: takedownMarkdown },
  { ...LEGAL_POLICY_METADATA[6], markdown: lawEnforcementMarkdown },
] as const;

export type LegalPolicy = (typeof LEGAL_POLICIES)[number];

const ADDITIONAL_LEGAL_POLICY_BY_SLUG = new Map<string, LegalPolicy>(
  LEGAL_POLICIES.slice(2).map((policy) => [policy.slug, policy] as const),
);

export function getAdditionalLegalPolicy(
  slug: string,
): LegalPolicy | undefined {
  return ADDITIONAL_LEGAL_POLICY_BY_SLUG.get(slug);
}
