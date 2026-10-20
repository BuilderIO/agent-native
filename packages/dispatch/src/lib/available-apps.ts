export interface AvailableApp {
  id: string;
  name: string;
  description: string;
}

export const AVAILABLE_APPS: readonly AvailableApp[] = [
  {
    id: "account-tiering",
    name: "Account Tiering",
    description:
      "Prioritize accounts using product, renewal, and relationship signals.",
  },
  {
    id: "call-follow-up-drafter",
    name: "Call Follow-up Drafter",
    description: "Turn call notes into clear follow-up emails and next steps.",
  },
  {
    id: "win-loss-memo",
    name: "Win-Loss Memo",
    description: "Capture deal outcomes and turn them into useful patterns.",
  },
  {
    id: "churn-early-warning",
    name: "Churn Early Warning",
    description: "Spot customer risk from product and relationship signals.",
  },
  {
    id: "account-expert",
    name: "Account Expert",
    description: "Keep a focused brief of what matters for each account.",
  },
  {
    id: "demo-clip-library",
    name: "Demo Clip Library",
    description:
      "Find the best product moments for each prospect and use case.",
  },
  {
    id: "outbound-in-your-voice",
    name: "Outbound in Your Voice",
    description:
      "Draft outbound that matches your team’s tone and proof points.",
  },
  {
    id: "linkedin-signal-watch",
    name: "LinkedIn Signal Watch",
    description: "Track useful buying signals from people and companies.",
  },
  {
    id: "linkedin-icp-prospect-tracker",
    name: "LinkedIn ICP Prospect Tracker",
    description:
      "Review and organize prospects against your ideal customer profile.",
  },
];

const PRODUCTION_ORIGIN = "https://community.agent-native.com";
const BETA_ORIGIN = "https://beta.community.agent-native.com";

export function availableAppUrl(appId: string): string {
  const origin =
    typeof window !== "undefined" &&
    window.location.hostname.trim().toLowerCase().startsWith("beta.")
      ? BETA_ORIGIN
      : PRODUCTION_ORIGIN;
  return `${origin}/${encodeURIComponent(appId)}`;
}
