export type CommunityAppStatus = "new" | "comingSoon";

export interface CommunityApp {
  slug: string;
  name: string;
  description: string;
  screenshots: string[];
  demoUrl?: string;
  repositoryUrl?: string;
  sourceUrl?: string;
  sourceLabel?: string;
  githubStars?: number;
  status?: CommunityAppStatus;
}

export const communityApps: CommunityApp[] = [
  {
    slug: "nomad",
    name: "Nomad",
    description /* i18n-ignore: reviewed community catalog content */:
      "A travel and residency cockpit for tracking trips, visas, fiscal residency, and immigration deadlines.",
    screenshots: [
      "/community/nomad/nomad-01.jpg",
      "/community/nomad/nomad-03.jpg",
      "/community/nomad/nomad-05.jpg",
    ],
    sourceUrl: "https://github.com/BuilderIO/agent-native/pull/2454",
    sourceLabel: "Draft PR #2454",
    status: "new",
  },
];

export function findCommunityApp(slug: string | undefined) {
  return communityApps.find((app) => app.slug === slug);
}

export function findCommunityAppInCatalog(
  apps: CommunityApp[],
  slug: string | undefined,
) {
  return apps.find((app) => app.slug === slug);
}
