export interface SearchEntry {
  page: string;
  path: string;
  section: string;
  sectionId: string;
  text: string;
}

export const searchIndex: SearchEntry[] = [
  // Getting Started
  {
    page: "Getting Started",
    path: "/docs",
    section: "Start from a Template",
    sectionId: "start-from-a-template",
    text: "The fastest way to get started is to pick a template and customize it. Templates are complete production-ready apps not starter kits. npx @agent-native/core create my-app --template mail. Use your AI coding tool Claude Code Cursor Windsurf to customize it.",
  },
  {
    page: "Getting Started",
    path: "/docs",
    section: "Choose a Template",
    sectionId: "choose-a-template",
    text: "Mail Superhuman Gmail email client. Calendar Google Calendar Calendly scheduling. Content Notion Google Docs writing. Slides Google Slides Pitch presentations. Video Remotion video composition. Analytics Amplitude Mixpanel Looker data platform. Each template is a complete app with UI agent actions database schema and AI instructions.",
  },
  {
    page: "Getting Started",
    path: "/docs",
    section: "Start from Scratch",
    sectionId: "start-from-scratch",
    text: "Create a blank project without --template flag. npx @agent-native/core create my-app. Framework scaffolding React frontend Nitro backend agent panel database but no domain-specific code.",
  },
  {
    page: "Getting Started",
    path: "/docs",
    section: "Project Structure",
    sectionId: "project-structure",
    text: "Every agent-native app follows the same structure: app/ React frontend routes components hooks. server/ Nitro API server routes plugins. actions/ agent-callable actions. .agents/ agent instructions and skills.",
  },
  {
    page: "Getting Started",
    path: "/docs",
    section: "Configuration",
    sectionId: "configuration",
    text: "Templates come pre-configured. vite.config.ts defineConfig. tsconfig.json extends @agent-native/core/tsconfig.base.json. tailwind.config.ts preset from @agent-native/core/tailwind.",
  },
  {
    page: "Getting Started",
    path: "/docs",
    section: "Architecture Principles",
    sectionId: "architecture-principles",
    text: "Agent and UI are equal partners. Everything the UI can do the agent can do and vice versa. Context-aware the agent always knows what you're looking at. Skills-driven core functionalities have instructions so the agent doesn't explore from scratch. Inter-agent communication via A2A protocol. Fully portable any SQL database any hosting backend any AI coding tool. Fork and customize single-tenant apps you clone and evolve.",
  },

  // Server
  {
    page: "Server",
    path: "/docs/server",
    section: "createServer()",
    sectionId: "createserver",
    text: "Creates a pre-configured Express app with standard middleware. Includes cors json limit 50mb urlencoded /_agent-native/ping. Options: cors CorsOptions or false CORS config pass false to disable. jsonLimit string JSON body parser limit default 50mb. pingMessage string health check response default env PING_MESSAGE or pong. disablePing boolean disable /_agent-native/ping endpoint.",
  },
  {
    page: "Server",
    path: "/docs/server",
    section: "createFileWatcher()",
    sectionId: "createfilewatcher",
    text: 'Creates a chokidar file watcher for real-time file change detection. createFileWatcher("./data") watcher emits all events eventName filePath. Options: ignored any glob patterns or regex to ignore. emitInitial boolean emit events for initial file scan default false.',
  },
  {
    page: "Server",
    path: "/docs/server",
    section: "createSSEHandler()",
    sectionId: "createssehandler",
    text: 'Creates an Express route handler that streams file changes as Server-Sent Events. Each SSE message is JSON type change path data/file.json. Options: extraEmitters additional EventEmitters to stream. app.get("/_agent-native/events", createSSEHandler(watcher))',
  },
  {
    page: "Server",
    path: "/docs/server",
    section: "createProductionServer()",
    sectionId: "createproductionserver",
    text: "Starts a production server with SPA fallback and graceful shutdown. server/node-build.ts createProductionServer(createAppServer()). Options: port number or string listen port default env PORT or 3000. spaDir string built SPA directory default dist/spa. appName string name for log messages default Agent-Native.",
  },

  // Client
  {
    page: "Client",
    path: "/docs/client",
    section: "sendToAgentChat()",
    sectionId: "sendtoagentchat",
    text: "Send a message to the agent chat via postMessage. Used to delegate AI tasks from UI interactions. Auto-submit a prompt with hidden context. Prefill without submitting user reviews first. sendToAgentChat({ message, context, submit })",
  },
  {
    page: "Client",
    path: "/docs/client",
    section: "AgentChatMessage",
    sectionId: "agentchatmessage",
    text: "AgentChatMessage options: message string the visible prompt sent to the chat. context string hidden context appended not shown in chat UI. submit boolean true auto-submit false prefill only. projectSlug string optional project slug. preset string optional preset name. referenceImagePaths string array optional reference image paths.",
  },
  {
    page: "Client",
    path: "/docs/client",
    section: "useAgentChatGenerating()",
    sectionId: "useagentchatgenerating",
    text: "React hook that wraps sendToAgentChat with loading state tracking. isGenerating turns true on send and automatically resets to false when the agent finishes generating.",
  },
  {
    page: "Client",
    path: "/docs/client",
    section: "useDbSync()",
    sectionId: "usedbsync",
    text: "React hook (formerly useFileWatcher) that polls for database changes and invalidates react-query caches. Options: queryClient React-query client for cache invalidation. queryKeys string array query key prefixes to invalidate default file fileTree. pollUrl string poll endpoint URL default /_agent-native/poll. onEvent callback for each poll event.",
  },
  {
    page: "Client",
    path: "/docs/client",
    section: "cn()",
    sectionId: "cn",
    text: 'Utility for merging class names clsx plus tailwind-merge. cn("px-4 py-2 rounded", isActive && "bg-primary text-primary-foreground", className)',
  },

  // Actions
  {
    page: "Actions",
    path: "/docs/actions",
    section: "Action Dispatcher",
    sectionId: "action-dispatcher",
    text: "The action system lets you create actions that agents can invoke via pnpm action name. Each action is a TypeScript file that exports a default async function. actions/run.ts dispatcher one-time setup runScript(). actions/hello.ts example action.",
  },
  {
    page: "Actions",
    path: "/docs/actions",
    section: "parseArgs()",
    sectionId: "parseargs",
    text: 'Parse CLI arguments in --key value or --key=value format. parseArgs(["--name", "Steve", "--verbose", "--count=3"]) returns { name: "Steve", verbose: "true", count: "3" }',
  },
  {
    page: "Actions",
    path: "/docs/actions",
    section: "Shared Agent Chat",
    sectionId: "shared-agent-chat",
    text: 'Isomorphic chat bridge that works in both browser and Node.js. agentChat.submit("Generate a report"). agentChat.prefill("Draft an email", contextData). agentChat.send({ message, context, submit }). In the browser messages are sent via window.postMessage(). In Node.js actions they use the BUILDER_PARENT_MESSAGE stdout format.',
  },
  {
    page: "Actions",
    path: "/docs/actions",
    section: "Utility Functions",
    sectionId: "utility-functions",
    text: "loadEnv(path?) load .env from project root or custom path. camelCaseArgs(args) convert kebab-case keys to camelCase. isValidPath(p) validate relative path no traversal no absolute. isValidProjectPath(p) validate project slug. ensureDir(dir) mkdir -p helper. fail(message) print error to stderr and exit(1).",
  },
  {
    page: "Actions",
    path: "/docs/actions",
    section: "File Sync Adapters",
    sectionId: "file-sync-adapters",
    text: "Bidirectional file sync across instances with pluggable adapters. Supports Google Cloud Firestore, Supabase Postgres, and Convex. All adapters implement FileSyncAdapter interface. FirestoreFileSyncAdapter real-time via onSnapshot. SupabaseFileSyncAdapter real-time via Supabase Realtime channels. ConvexFileSyncAdapter real-time via reactive queries. Features startup sync remote change listeners chokidar file watchers three-way merge with LCS-based conflict resolution and .conflict sidecar files. Custom adapters via @agent-native/core/adapters/sync.",
  },

  // Harnesses
  {
    page: "Harnesses",
    path: "/docs/harnesses",
    section: "Embedded Agent Panel",
    sectionId: "embedded-agent",
    text: "Ships with @agent-native/core no separate package needed. Agent panel embedded directly in your app with chat and optional CLI terminal. Supports multiple AI coding CLIs Claude Code Codex Gemini CLI OpenCode Builder.io. Switch between them from the settings panel. Toggle between production mode app tools only and development mode full filesystem shell and database access. Great for local development self-hosted production and OSS.",
  },
  {
    page: "Harnesses",
    path: "/docs/harnesses",
    section: "Supported CLIs",
    sectionId: "supported-clis",
    text: "Claude Code claude --dangerously-skip-permissions --resume --verbose. Codex codex --full-auto --quiet. Gemini CLI gemini --sandbox. OpenCode opencode. Builder.io builder. Switch between CLIs at any time from the agent panel settings.",
  },
  {
    page: "Harnesses",
    path: "/docs/harnesses",
    section: "Builder.io Cloud Harness",
    sectionId: "cloud-harness",
    text: "Provided by Builder.io available at builder.io. Runs in the cloud. Real-time collaboration multiple users can watch interact simultaneously. Visual editing capabilities alongside the AI agent. Parallel agent execution for faster iteration. Best for teams.",
  },
  {
    page: "Harnesses",
    path: "/docs/harnesses",
    section: "How It Works",
    sectionId: "how-it-works",
    text: "Agent chat use sendToAgentChat() to send messages to the agent. Generation state use useAgentChatGenerating() to track when the agent is running. Database sync useDbSync polls for changes and keeps UI in sync when the agent modifies data. Action system pnpm action dispatches to callable actions. Your app code is identical regardless of how the agent is provided.",
  },

  // Key Concepts
  {
    page: "Key Concepts",
    path: "/docs/key-concepts",
    section: "Why Agent-Native",
    sectionId: "why-agent-native",
    text: "Teams have four options for AI-powered work and none are ideal. Chat apps like Claude Projects ChatGPT are accessible but not built for structured workflows. Raw agent interfaces like Claude Code Cursor are powerful but inaccessible to non-devs. Custom AI apps are limited the AI cant see what you see cant react to what you click. Existing SaaS like Amplitude HubSpot are bolting AI onto architectures not designed for it. Agent-native apps make agent and UI equal citizens of the same system. Like Claude Code but with buttons and visual interfaces.",
  },
  {
    page: "Key Concepts",
    path: "/docs/key-concepts",
    section: "Data in SQL",
    sectionId: "data-in-sql",
    text: "All application state lives in a SQL database via Drizzle ORM. Supports SQLite Neon Postgres Turso Supabase Cloudflare D1. Core SQL stores are auto-created: application_state settings oauth_tokens sessions.",
  },
  {
    page: "Key Concepts",
    path: "/docs/key-concepts",
    section: "Agent Chat Bridge",
    sectionId: "agent-chat-bridge",
    text: "UI never calls an LLM directly. Sends message to agent via postMessage. Agent has full conversation history skills instructions. Transport is window.parent.postMessage in browser. BUILDER_PARENT_MESSAGE stdout format in Node actions. sendToAgentChat submit prefill. Everything goes through the agent so any app can be driven from Slack Telegram or another agent.",
  },
  {
    page: "Key Concepts",
    path: "/docs/key-concepts",
    section: "Real-time SSE Sync",
    sectionId: "sse-sync",
    text: "Database changes sync to UI via polling. useDbSync hook (formerly useFileWatcher) invalidates react-query caches when data updates. createFileWatcher createSSEHandler.",
  },
  {
    page: "Key Concepts",
    path: "/docs/key-concepts",
    section: "File Sync",
    sectionId: "file-sync",
    text: "Pluggable adapter system syncs files to a database in real-time. Three adapters ship out of the box: Google Cloud Firestore real-time via onSnapshot. Supabase Postgres real-time via Supabase Realtime channels. Convex real-time via reactive queries. All adapters use chokidar file watching three-way merge with LCS-based conflict resolution and .conflict sidecar files. Database is never source of truth files are. Database is sync mechanism for collaboration. Configure which files sync via glob patterns in sync-config.json.",
  },
  {
    page: "Key Concepts",
    path: "/docs/key-concepts",
    section: "Agent Modifies Code",
    sectionId: "agent-modifies-code",
    text: "Agent can edit apps own source code components routes styles actions. Fork and evolve pattern. Fork a template customize by asking the agent. Add new chart types connect to Stripe write integrations. Combined with git-based workflows roles ACLs for safety.",
  },

  // Creating Templates
  {
    page: "Creating Templates",
    path: "/docs/creating-templates",
    section: "Overview",
    sectionId: "overview",
    text: "Templates are complete forkable agent-native apps that solve a specific use case. Anyone can create a template and share with the community. Good templates solve a real workflow have comprehensive AGENTS.md include actions follow five rules.",
  },
  {
    page: "Creating Templates",
    path: "/docs/creating-templates",
    section: "Start from the Starter",
    sectionId: "start-from-starter",
    text: "npx @agent-native/core create my-template scaffolds a minimal agent-native app with standard directory structure working dev server file watching SSE example action.",
  },
  {
    page: "Creating Templates",
    path: "/docs/creating-templates",
    section: "Write AGENTS.md",
    sectionId: "write-agents-md",
    text: "Most important file in your template. Tells AI agent how app works what it can and cant do. Include architecture principles directory structure available actions data model key patterns.",
  },
  {
    page: "Creating Templates",
    path: "/docs/creating-templates",
    section: "Publishing",
    sectionId: "publishing",
    text: "Push template to public GitHub repo. Works with pnpm install and pnpm dev. Include seed data in data directory. Community templates shared via GitHub. npx @agent-native/core create my-app --template github:user/repo.",
  },

  // Templates
  {
    page: "Analytics Template",
    path: "/templates/analytics",
    section: "AI-Native Analytics",
    sectionId: "",
    text: "Open source alternative to Amplitude Mixpanel Looker. Full BI platform with 20+ data connectors SQL query explorer reusable dashboards data dictionary with 550+ metric definitions. Connect BigQuery HubSpot Stripe Jira Sentry Slack GitHub and more. Natural language chart generation AI agent builds charts writes queries modifies the app. npx @agent-native/core create my-app --template analytics",
  },
  {
    page: "Analytics Template",
    path: "/templates/analytics",
    section: "Features",
    sectionId: "",
    text: "20+ data connectors BigQuery HubSpot Stripe Jira Sentry GitHub Slack Grafana Google Cloud Apollo Gong Notion. SQL query explorer with history row count tracking shareable URLs export. Reusable dashboards multi-view subviews date range controls. Data dictionary 550+ metrics query templates join patterns. Rich visualizations area charts time series leaderboards kanban boards. 50+ pre-built actions. Ad-hoc analysis system. Data quality trust scoring.",
  },
  {
    page: "Content Template",
    path: "/templates/content",
    section: "AI-Native Content",
    sectionId: "",
    text: "Open source alternative to Notion Google Docs. Write and organize content with an AI agent that knows your brand voice style guide and tone. CMS integration WordPress Contentful Builder headless CMS. Publishing workflows review approval scheduling. AI editing rewriting highlighting in-place edits. Content organization folders tags search. npx @agent-native/core create my-app --template content",
  },
  {
    page: "Slides Template",
    path: "/templates/slides",
    section: "AI-Native Slides",
    sectionId: "",
    text: "Open source alternative to Google Slides Pitch. Generate and edit React-based presentations via prompt or point-and-click. Prompt-to-deck describe your presentation topic and audience. Visual editing pixel-level control. React-based slides animations live data interactive elements. Iterative refinement conversational editing. Custom themes brand fonts colors layouts. npx @agent-native/core create my-app --template slides",
  },
  {
    page: "Video Template",
    path: "/templates/video",
    section: "AI-Native Video",
    sectionId: "",
    text: "Open source AI video editor and generator built on Remotion. Create and edit video compositions with an AI agent. Prompt-to-video scenes transitions text overlays timing. Agent-assisted editing speed up intro add fade change timing. Programmatic rendering batch personalized videos social content data-driven visualizations. Live preview real-time scrub timeline. npx @agent-native/core create my-app --template video",
  },
  // Resources & Skills
  {
    page: "Resources & Skills",
    path: "/docs/resources",
    section: "Overview",
    sectionId: "overview",
    text: "Resources are persistent SQL-backed files. Notes configs skills. Available to both UI and agent. Personal and shared scopes. Work in serverless edge and production.",
  },
  {
    page: "Resources & Skills",
    path: "/docs/resources",
    section: "Skills",
    sectionId: "skills",
    text: "Skills are Markdown resource files that give the agent domain knowledge. Live under skills/ path prefix. Referenced in AGENTS.md. Create via Resources panel or .agents/skills/ directory.",
  },
  {
    page: "Resources & Skills",
    path: "/docs/resources",
    section: "@ File Tagging",
    sectionId: "at-file-tagging",
    text: "Type @ in chat input to reference files. Dropdown shows matching files. Inline chip. Dev mode shows codebase and resources. Production shows resources only.",
  },
  {
    page: "Resources & Skills",
    path: "/docs/resources",
    section: "/ Slash Commands",
    sectionId: "slash-commands",
    text: "Type / at start of line to invoke a skill. Dropdown shows available skills. Inline chip. Dev mode shows .agents/skills/ and resources. Production shows resource skills only.",
  },
  {
    page: "Resources & Skills",
    path: "/docs/resources",
    section: "Resource API",
    sectionId: "resource-api",
    text: "REST endpoints for resources. resource-list resource-read resource-write resource-delete. Server API and action API. /api/resources endpoints.",
  },

  // Core Philosophy
  {
    page: "Core Philosophy",
    path: "/docs/core-philosophy",
    section: "Agent + UI Parity",
    sectionId: "agent-ui-parity",
    text: "Everything the UI can do the agent can do. Everything the agent can do the UI can do. If a user can create a form from the UI the agent must have an action to create it too. No feature is complete until both sides can use it.",
  },
  {
    page: "Core Philosophy",
    path: "/docs/core-philosophy",
    section: "The Four-Area Checklist",
    sectionId: "four-area-checklist",
    text: "Every new feature must update all four areas: UI component, action, skills/instructions, and application state sync. Skipping any one breaks the agent-native contract.",
  },
  {
    page: "Core Philosophy",
    path: "/docs/core-philosophy",
    section: "Database Agnostic",
    sectionId: "database-agnostic",
    text: "All data lives in SQL via Drizzle ORM. Supports SQLite Neon Postgres Turso Supabase Cloudflare D1. Never write SQLite-only syntax. Use getDbExec isPostgres intType helpers for dialect-agnostic SQL.",
  },
  {
    page: "Core Philosophy",
    path: "/docs/core-philosophy",
    section: "Hosting Agnostic",
    sectionId: "hosting-agnostic",
    text: "Server runs on Nitro compiles to any deployment target. Node.js Cloudflare Workers Netlify Vercel Deno Deploy AWS Lambda Bun. Never use Node-specific APIs in server routes. Never assume a persistent server process.",
  },

  // A2A Protocol
  {
    page: "A2A Protocol",
    path: "/docs/a2a-protocol",
    section: "Overview",
    sectionId: "overview",
    text: "Agent-to-agent communication via JSON-RPC protocol. Agents discover each other via agent cards send messages and receive structured results. mountA2A server setup. A2AClient for calling other agents. callAgent convenience helper.",
  },
  {
    page: "A2A Protocol",
    path: "/docs/a2a-protocol",
    section: "Agent Card",
    sectionId: "agent-card",
    text: "Auto-generated at /.well-known/agent-card.json. Describes agent name description skills capabilities security. Protocol version 0.3. Other agents fetch this to discover capabilities.",
  },
  {
    page: "A2A Protocol",
    path: "/docs/a2a-protocol",
    section: "JSON-RPC Methods",
    sectionId: "json-rpc-methods",
    text: "message/send send message get completed task. message/stream send message receive SSE task updates. tasks/get fetch task by ID. tasks/cancel cancel running task. Messages contain typed parts: text data file.",
  },
  {
    page: "A2A Protocol",
    path: "/docs/a2a-protocol",
    section: "Task Lifecycle",
    sectionId: "task-lifecycle",
    text: "Each message creates a task: submitted working completed failed canceled input-required. Tasks persist in a2a_tasks SQL table. Retrieved via tasks/get.",
  },

  // Context Awareness
  {
    page: "Context Awareness",
    path: "/docs/context-awareness",
    section: "Navigation State",
    sectionId: "navigation-state",
    text: "UI writes navigation key to application-state on every route change. Includes view item IDs filter state selections. Agent reads readAppState navigation before acting.",
  },
  {
    page: "Context Awareness",
    path: "/docs/context-awareness",
    section: "The view-screen Action",
    sectionId: "view-screen-action",
    text: "Every template should have a view-screen action. Reads navigation state fetches contextual data returns snapshot of what user sees. The agent should always call view-screen before acting. Hard convention across all templates.",
  },
  {
    page: "Context Awareness",
    path: "/docs/context-awareness",
    section: "The navigate Action",
    sectionId: "navigate-action",
    text: "Agent writes one-shot navigate command to application-state. UI reads it performs navigation deletes entry. writeAppState navigate view threadId. Agent never writes to navigation key directly.",
  },
  {
    page: "Context Awareness",
    path: "/docs/context-awareness",
    section: "Jitter Prevention",
    sectionId: "jitter-prevention",
    text: "Source tagging prevents UI from refetching data it just wrote. Agent writes tagged requestSource agent. UI writes include tab ID via X-Request-Source header. ignoreSource in useDbSync (formerly useFileWatcher) filters own writes.",
  },

  // Skills Guide
  {
    page: "Skills Guide",
    path: "/docs/skills-guide",
    section: "What Are Skills",
    sectionId: "what-are-skills",
    text: "Skills are Markdown files at .agents/skills/name/SKILL.md with detailed guidance for the agent. Each skill focuses on one concern. Referenced in AGENTS.md and triggered by agent tool system.",
  },
  {
    page: "Skills Guide",
    path: "/docs/skills-guide",
    section: "Framework Skills",
    sectionId: "framework-skills",
    text: "Built-in skills: storing-data real-time-sync delegate-to-agent actions self-modifying-code create-skill capture-learnings frontend-design adding-a-feature context-awareness a2a-protocol.",
  },
  {
    page: "Skills Guide",
    path: "/docs/skills-guide",
    section: "Creating Custom Skills",
    sectionId: "creating-skills",
    text: "Create a skill when pattern should be followed repeatedly workflow needs guidance scaffolding from template. YAML frontmatter with name and description plus markdown body with Rule Why How Do Don't sections.",
  },
  {
    page: "Skills Guide",
    path: "/docs/skills-guide",
    section: "Skills vs AGENTS.md",
    sectionId: "skills-vs-agents-md",
    text: "AGENTS.md is the overview tells agent what app does. Skills are deep dives tell agent how to do specific things correctly. Both needed: AGENTS.md for orientation skills for execution.",
  },
];
