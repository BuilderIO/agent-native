import { createGitHubRepoFilesAction } from "@agent-native/core/provider-api/actions/github-repo-files";

import { getAnalyticsProviderApiRuntime } from "../server/lib/provider-api";

// Static action registry marker: createGitHubRepoFilesAction returns defineAction.
export default createGitHubRepoFilesAction(getAnalyticsProviderApiRuntime(), {
  description:
    "List, search, and read connected GitHub repository files through the Analytics GitHub data source. Use this to inspect remote repos for tracking-event instrumentation, event-name definitions, analytics calls, and related code context without cloning. Prefer operation='search' with includeTextMatches=true before operation='read'. Write and delete operations exist for explicit repo-maintenance requests only and require human approval.",
});
