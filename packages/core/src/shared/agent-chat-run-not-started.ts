/**
 * Marks the durable assistant notice the server writes for a turn it refused
 * before any run started. The same failure is a failed AgentKit run, which the
 * chat renders as a recovery card, so the AgentKit projection hides the notice.
 */
export const RUN_NOT_STARTED_METADATA_KEY = "agentNativeRunNotStarted";
