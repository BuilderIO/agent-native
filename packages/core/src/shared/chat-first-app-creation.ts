export type ChatFirstAppCreationVaultAccessMode = "all-apps" | "manual";

export interface ChatFirstAppCreationResource {
  name: string;
  kind: string;
  path: string;
}

export interface ChatFirstAppCreationPromptInput {
  appId: string;
  prompt: string;
  selectedKeys: string[];
  selectedResources: ChatFirstAppCreationResource[];
  vaultAccessMode: ChatFirstAppCreationVaultAccessMode;
  appRoot?: string;
  mountPath?: string;
  scaffoldCommand?: string;
  additionalInstructions?: string[];
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/^[^a-z]+/, "")
    .slice(0, 48);
}

export function titleFromChatFirstAppPrompt(prompt: string): string {
  const cleaned = prompt
    .replace(/\b(build|create|make|an?|the|app|tool|dashboard)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return slugify(cleaned || "new-app") || "new-app";
}

export function buildChatFirstAppCreationPrompt(
  input: ChatFirstAppCreationPromptInput,
): string {
  const appRoot = input.appRoot?.trim() || `apps/${input.appId}`;
  const mountPath = input.mountPath?.trim() || `/${input.appId}`;
  const packagePath = `${appRoot.replace(/\/+$/, "")}/package.json`;
  const keyList = input.selectedKeys.join(", ");
  const grantRequest =
    input.vaultAccessMode === "all-apps"
      ? "Dispatch vault access: all saved vault keys are available to every workspace app by default. No per-app vault grants are needed."
      : keyList
        ? `Requested Dispatch vault key grants for this app: ${keyList}`
        : "Requested Dispatch vault key grants for this app: none";
  const resourceList = input.selectedResources.length
    ? input.selectedResources
        .map(
          (resource) =>
            `- ${resource.name} (${resource.kind}, ${resource.path})`,
        )
        .join("\n")
    : "none";
  const scaffoldInstructions = input.scaffoldCommand
    ? ["", "Scaffold instructions:", input.scaffoldCommand]
    : [];

  return [
    "Create a new agent-native app in this workspace.",
    "This is a new workspace app request, not a feature request for the current app.",
    ...scaffoldInstructions,
    "",
    `Suggested app name: ${input.appId} (you may adjust the slug if it conflicts)`,
    `User prompt: ${input.prompt.trim()}`,
    `Generate a concise one-sentence app description from the user prompt before coding; save it in ${packagePath} \"description\" so Dispatch and A2A can describe the app.`,
    "If the user mentions a product or company such as Granola, Loom, Superhuman, Linear, or Notion, treat it as product inspiration unless they explicitly ask to connect to that service. Do not invent or require third-party API keys like GRANOLA_API_KEY just because a product is named.",
    grantRequest,
    `Requested Dispatch workspace resources for this app:\n${resourceList}`,
    "Dispatch workspace resources with scope=all are inherited workspace context. Do not copy or sync them into the new app; every workspace app reads them at runtime and may override with app shared or personal resources.",
    "",
    "Pick a UI template that fits the user's prompt - analytics, assets, brain, calendar, chat, content, design, dispatch, forms, mail, slides, or clips when none of the others fit.",
    'If you use the chat template, treat it as scaffolding only: the finished app must use the requested app\'s real name, home screen, navigation, package metadata, and manifest, and it must not leave visible "Chat", "Starter", "Blank app", or "New app" UI behind.',
    `Use the workspace app layout: create it under ${appRoot}, mount it at ${mountPath}, keep it on the shared workspace database/hosting model, and avoid table-name collisions by namespacing any new domain tables to the app.`,
    `Important routing rule: from outside the app, link to ${mountPath}; inside ${appRoot}, React Router routes are app-local. Use <Link to=\"/review\"> and navigate(\"/review\"), not \"${mountPath}/review\"; APP_BASE_PATH supplies the mounted prefix, and hardcoding it causes doubled URLs.`,
    'Prefer useActionQuery/useActionMutation for actions. If you must raw-fetch framework endpoints, wrap them with agentNativePath("/_agent-native/actions/<name>") so mounted apps call the right URL.',
    `Use relative workspace links like ${mountPath}. Do not hardcode localhost, 127.0.0.1, 8080, 8100, or any dev port; the active workspace gateway or Desktop shell owns the port.`,
    "Use the framework/template UI stack: shadcn/ui components and @tabler/icons-react. Do not add lucide-react or another icon library for standard UI.",
    "Existing first-party apps are neighbors, not implementation details for this app. If the user's prompt mentions Mail, Calendar, Analytics, Brain, Assets, Dispatch, or other templates, treat them as existing hosted/connected apps that this app can link to or call through A2A/default connected agents. For example, Mail, Calendar, Analytics, Brain, and Assets already exist at https://mail.agent-native.com, https://calendar.agent-native.com, https://analytics.agent-native.com, https://brain.agent-native.com, and https://assets.agent-native.com.",
    `Do not create wrapper apps or scaffold child apps/routes for Mail, Calendar, Analytics, Brain, Assets, etc. inside ${appRoot} just so this app can access them. If the request is a cross-app dashboard or overview, build only the new dashboard/overview app and delegate to the existing apps for domain work.`,
    "Only create another first-party app when the user explicitly asks for a customized app from that template; otherwise keep using the hosted/shared app so improvements to the base app keep flowing to users.",
    "Do not satisfy this by adding a route, page, component, or file inside apps/chat or another existing app unless the user explicitly asks to modify that existing app.",
    input.vaultAccessMode === "all-apps"
      ? "Do not create per-app Dispatch vault grants unless the workspace switches vault access to manual or the user explicitly asks for manual grants."
      : keyList
        ? `After the app exists, grant the selected Dispatch vault keys to appId "${input.appId}" and sync them once the app server is available. Treat these as requested grants, not active grants before creation succeeds.`
        : "Do not grant any Dispatch vault keys unless the user asks later.",
    input.selectedResources.length
      ? `After the app exists, grant the selected Dispatch workspace resources to appId "${input.appId}". Do not sync All-app workspace resources; they are inherited.`
      : "Do not grant any selected-only Dispatch workspace resources unless the user asks later.",
    "",
    "App readiness requirements before handing off:",
    `- Ensure ${packagePath} exists with displayName/name and a concise description; Dispatch discovers workspace apps from the workspace filesystem and app metadata.`,
    "- Update the app manifest/package/deploy metadata needed by the existing workspace deployment model.",
    `- Ensure the React Router client entry preserves APP_BASE_PATH/VITE_APP_BASE_PATH so ${mountPath} hydrates correctly.`,
    "- Verify the app's agent card/A2A metadata is ready so Dispatch can discover and delegate to the app after deployment. Every sibling workspace app is available over A2A by default through call-agent, with names and descriptions from the workspace app registry.",
    `When it is ready, start or update the workspace dev server and navigate the user to ${mountPath} on the workspace origin. Do not prefix it with /dispatch/, /apps/, /workspace/, or any other Dispatch tab.`,
    ...(input.additionalInstructions ?? []),
  ].join("\n");
}
