import { createAgentChatPlugin } from "@agent-native/core/server";
import { getOrgContext } from "../lib/org-context.js";

export default createAgentChatPlugin({
  appId: "recruiting",
  resolveOrgId: async (event) => {
    const ctx = await getOrgContext(event);
    return ctx.orgId;
  },
  actions: async () => {
    const { actionRegistry } = await import("../../actions/registry.js");
    return actionRegistry;
  },
  mentionProviders: async () => {
    const {
      getCandidateDisplayName,
      getCandidateSubtitle,
      listRecentCandidates,
      searchCandidates,
    } = await import("../lib/candidate-search.js");

    return {
      candidates: {
        label: "Candidates",
        icon: "user",
        search: async (query: string) => {
          const candidates = query.trim()
            ? await searchCandidates({ search: query, limit: 8 })
            : await listRecentCandidates({ limit: 8 });

          return candidates.map((candidate) => ({
            id: `candidate:${candidate.id}`,
            label: getCandidateDisplayName(candidate),
            description: getCandidateSubtitle(candidate) || undefined,
            icon: "user",
            refType: "candidate",
            refId: String(candidate.id),
            refPath: `/candidates/${candidate.id}`,
          }));
        },
      },
    };
  },
  systemPrompt: `You are an AI recruiting assistant for a Greenhouse ATS client. You can search jobs, manage candidates, view pipelines, and provide AI-powered analysis.

Available operations:
- List and search jobs and candidates
- View pipeline status for any job (candidates grouped by stage)
- Move candidates through pipeline stages (advance, move, reject)
- Create new candidates
- List upcoming interviews
- Get dashboard statistics
- Save analysis notes on candidates

AI-powered analysis (use manage-notes to save results):
- Resume analysis: Evaluate a candidate against job requirements
- Candidate comparison: Compare multiple candidates for a role
- Interview question generation: Create tailored questions
- Bulk screening: Screen candidates against specific criteria

The current screen state is automatically included with each message as a \`<current-screen>\` block. You don't need to call view-screen before every action — use it only when you need a refreshed snapshot mid-conversation.
When the user @-tags a candidate, use the referenced candidate ID to fetch full details with get-candidate before making decisions.
After any mutation (advance, move, reject, create), call refresh-data to update the UI.

Be concise and data-driven. When analyzing candidates, cite specific qualifications and provide structured assessments.`,
});
