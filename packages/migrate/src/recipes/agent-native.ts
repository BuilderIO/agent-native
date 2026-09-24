import type {
  MigrationContext,
  MigrationRecipe,
  MigrationTask,
  ProjectIR,
} from "../types.js";

export const AGENT_NATIVE_RECIPE_NAMES = [
  "api-routes-to-actions",
  "app-data-to-drizzle",
  "llm-calls-to-agent-chat",
  "important-client-state-to-application-state",
  "mutations-to-optimistic-actions",
  "shared-resources-to-access-helpers",
  "public-pages-to-ssr",
  "logged-in-pages-to-client-app-shell",
] as const;

export type AgentNativeRecipeName = (typeof AGENT_NATIVE_RECIPE_NAMES)[number];

export function createAgentNativeRecipes(): MigrationRecipe[] {
  return [
    recipe("api-routes-to-actions", "Convert API routes to actions", (ir) =>
      ir.behavior.apiEndpoints.map((endpoint) => ({
        title: `Convert ${endpoint.path} to an action`,
        targetIds: [endpoint.id],
        confidence: endpoint.method === "ANY" ? "medium" : "high",
        summary:
          "Move standard JSON request/response behavior into actions/. Keep uploads, webhooks, OAuth callbacks, and streaming routes as server routes.",
      })),
    ),
    recipe("app-data-to-drizzle", "Move app data to Drizzle SQL", (ir) =>
      ir.behavior.dataStores.map((store) => ({
        title: `Model ${store.name} data from ${store.filePath}`,
        targetIds: [store.id],
        confidence: "medium",
        summary:
          "Create additive Drizzle schema and actions for app-owned domain data.",
      })),
    ),
    recipe(
      "llm-calls-to-agent-chat",
      "Delegate LLM calls to agent chat",
      (ir) =>
        ir.behavior.llmCalls.map((call) => ({
          title: `Delegate ${call.provider} call in ${call.filePath}`,
          targetIds: [call.id],
          confidence: "medium",
          summary:
            "Replace direct application LLM calls with agent chat delegation so AI work stays observable and tool-aware.",
        })),
    ),
    recipe(
      "important-client-state-to-application-state",
      "Expose important client state",
      (ir) =>
        ir.behavior.clientState.map((state) => ({
          title: `Review client state in ${state.filePath}`,
          targetIds: [state.id],
          confidence: "low",
          summary:
            "Classify state that affects agent context and expose navigation/selection via application_state.",
        })),
    ),
    recipe(
      "mutations-to-optimistic-actions",
      "Use optimistic action mutations",
      (ir) =>
        ir.site.routes
          .filter((route) => route.kind === "app")
          .map((route) => ({
            title: `Review mutations for ${route.path}`,
            targetIds: [route.id],
            confidence: "medium",
            summary:
              "Wire UI mutations through actions with optimistic React Query updates.",
          })),
    ),
    recipe(
      "shared-resources-to-access-helpers",
      "Use sharing/access helpers",
      (ir) =>
        ir.behavior.dataStores.map((store) => ({
          title: `Review sharing for ${store.name}`,
          targetIds: [store.id],
          confidence: "medium",
          summary:
            "Use ownable columns, accessFilter, resolveAccess, and assertAccess for user-authored resources.",
        })),
    ),
    recipe("public-pages-to-ssr", "Keep public pages SSR", (ir) =>
      ir.site.routes
        .filter((route) => route.public)
        .map((route) => ({
          title: `Keep ${route.path} server rendered`,
          targetIds: [route.id],
          confidence: "high",
          summary:
            "Render public, SEO-sensitive routes on the server instead of hiding content behind ClientOnly.",
        })),
    ),
    recipe(
      "logged-in-pages-to-client-app-shell",
      "Mount logged-in pages in client app shell",
      (ir) =>
        ir.site.routes
          .filter((route) => route.kind === "app")
          .map((route) => ({
            title: `Mount ${route.path} in the app shell`,
            targetIds: [route.id],
            confidence: "high",
            summary:
              "Use the persistent agent-native app shell for authenticated workflows so the agent sidebar does not remount.",
          })),
    ),
  ];
}

function recipe(
  name: AgentNativeRecipeName,
  title: string,
  select: (ir: ProjectIR) => Array<{
    title: string;
    targetIds: string[];
    confidence: MigrationTask["confidence"];
    summary: string;
  }>,
): MigrationRecipe {
  return {
    name,
    title,
    description: title,
    async selectTasks(context: MigrationContext) {
      return select(context.ir).map((task, index) => ({
        id: `${context.run.id}:${name}-${index + 1}`,
        runId: context.run.id,
        recipeName: name,
        title: task.title,
        status: "pending",
        confidence: task.confidence,
        targetIds: task.targetIds,
        summary: task.summary,
        updatedAt: new Date().toISOString(),
      }));
    },
  };
}
