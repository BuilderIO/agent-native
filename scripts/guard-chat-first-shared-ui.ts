import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

const roots = [
  "packages/dispatch/src/components/layout",
  "packages/desktop-app/src/renderer/components",
];

const violations = roots.flatMap((root) => {
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch (error) {
    throw new Error(`[guard:chat-first-shared-ui] Unable to read ${root}`, {
      cause: error,
    });
  }
  return entries
    .filter(
      (entry) => /chat-first/i.test(entry) && /\.(tsx?|jsx?)$/.test(entry),
    )
    .map((entry) => relative(process.cwd(), join(root, entry)));
});

const chatSidebarPath = "templates/chat/app/components/layout/Sidebar.tsx";
const chatLayoutPath = "templates/chat/app/components/layout/Layout.tsx";
const chatHomeRoutePath = "templates/chat/app/routes/home.tsx";
const chatSurfacePath =
  "templates/chat/app/components/chat/ChatRouteContent.tsx";
const chatThreadRoutePath = "templates/chat/app/routes/chat.$threadId.tsx";
const chatRootPath = "templates/chat/app/root.tsx";
const chatToolkitProviderPath =
  "templates/chat/app/components/ui/toolkit-provider.tsx";
let chatSidebar: string;
let chatLayout: string;
let chatHomeRoute: string;
let chatSurface: string;
let chatThreadRoute: string;
let chatRoot: string;
let chatToolkitProvider: string;
try {
  chatSidebar = readFileSync(chatSidebarPath, "utf8");
  chatLayout = readFileSync(chatLayoutPath, "utf8");
  chatHomeRoute = readFileSync(chatHomeRoutePath, "utf8");
  chatSurface = readFileSync(chatSurfacePath, "utf8");
  chatThreadRoute = readFileSync(chatThreadRoutePath, "utf8");
  chatRoot = readFileSync(chatRootPath, "utf8");
  chatToolkitProvider = readFileSync(chatToolkitProviderPath, "utf8");
} catch (error) {
  throw new Error(
    `[guard:chat-first-shared-ui] Unable to read the Chat template contract files`,
    { cause: error },
  );
}

const chatRailViolations = [
  chatSidebar.includes("<SidebarFooterActions")
    ? "Chat rail must not restore the generic footer action stack"
    : null,
  chatSidebar.includes('href: "/settings"')
    ? "Chat rail Settings belongs in the workspace switcher, not a standalone nav row"
    : null,
  !chatSidebar.includes("{searchButton}\n            {collapseButton}")
    ? "Expanded Chat rail must keep search and collapse together in the top utility area"
    : null,
  !chatSidebar.includes("compact={collapsed}") ||
  !chatSidebar.includes('currentAppId="chat"')
    ? "Chat rail must keep the compact workspace switcher available in both rail states"
    : null,
].filter((violation): violation is string => Boolean(violation));

const chatRouteViolations = [
  !chatHomeRoute.includes('markAgentChatHomeHandoff("chat")') ||
  !chatHomeRoute.includes("getChatHomeThreadId") ||
  !chatHomeRoute.includes("useNavigate") ||
  !/navigate\(\s*`\/chat\/\$\{encodeURIComponent\(threadId\)\}`,\s*\{\s*replace:\s*true,?\s*\}\s*\)/s.test(
    chatHomeRoute,
  ) ||
  !chatHomeRoute.includes("return null;")
    ? "Chat /home must route a pending thread to the shared durable Chat surface"
    : null,
  !(
    chatThreadRoute.includes(
      'import ChatRouteContent from "@/components/chat/ChatRouteContent"',
    ) ||
    chatThreadRoute.includes('import("@/components/chat/ChatRouteContent")')
  ) ||
  !chatRoot.includes("<AppProviders") ||
  !chatRoot.includes("isPublicPath={isMarketingPath}")
    ? "Chat /chat/:threadId must render the shared Chat surface behind the root client boundary"
    : null,
  !chatSurface.includes("AgentKitRoot") || !chatSurface.includes("AgentKitChat")
    ? "Chat /chat/:threadId must render the shared AgentKit Chat surface"
    : null,
].filter((violation): violation is string => Boolean(violation));

const chatBootstrapViolations = [
  chatSidebar.includes('from "@agent-native/core/client/agentkit-chat"') ||
  chatLayout.includes('from "@agent-native/core/client/agentkit-chat"')
    ? "Chat shell chrome must use the lightweight AgentKit rail entry point"
    : null,
  chatToolkitProvider.includes('from "@agent-native/toolkit"')
    ? "Chat shell providers must not load the broad Toolkit barrel before hydration"
    : null,
  chatSidebar.includes('from "@agent-native/toolkit/chat-history"')
    ? "Chat shell history must import its focused component entry point"
    : null,
  chatLayout.includes('from "@agent-native/toolkit/app-shell"')
    ? "Chat shell layout must import its focused app-shell entry point"
    : null,
].filter((violation): violation is string => Boolean(violation));

if (
  violations.length > 0 ||
  chatRailViolations.length > 0 ||
  chatRouteViolations.length > 0 ||
  chatBootstrapViolations.length > 0
) {
  console.error(
    [
      violations.length > 0
        ? `duplicate host component file(s):\n${violations.map((file) => `- ${file}`).join("\n")}\nMove the React implementation into packages/core/src/client/chat-first/.`
        : null,
      chatRailViolations.length > 0
        ? `Chat rail contract violation(s):\n${chatRailViolations.map((violation) => `- ${violation}`).join("\n")}`
        : null,
      chatRouteViolations.length > 0
        ? `Chat route contract violation(s):\n${chatRouteViolations.map((violation) => `- ${violation}`).join("\n")}`
        : null,
      chatBootstrapViolations.length > 0
        ? `Chat bootstrap contract violation(s):\n${chatBootstrapViolations.map((violation) => `- ${violation}`).join("\n")}`
        : null,
    ]
      .filter(Boolean)
      .map((message) => `[guard:chat-first-shared-ui] ${message}`)
      .join("\n"),
  );
  process.exitCode = 1;
} else {
  console.log("[guard:chat-first-shared-ui] clean");
}
