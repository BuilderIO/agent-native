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
    section: "Installation",
    sectionId: "installation",
    text: "Create a new project: npx @agent-native/core create my-app",
  },
  {
    page: "Getting Started",
    path: "/docs",
    section: "Project Structure",
    sectionId: "project-structure",
    text: "Every agent-native app follows the same convention: client/ React frontend Vite SPA App.tsx entry point components UI components lib/utils.ts cn() utility server/ Express backend index.ts createAppServer() node-build.ts production entry point shared/ isomorphic code client and server scripts/ agent-callable scripts run.ts script dispatcher data/ app data files watched by SSE",
  },
  {
    page: "Getting Started",
    path: "/docs",
    section: "Vite Configuration",
    sectionId: "vite-configuration",
    text: "Two config files client SPA and server build. defineConfig() sets up React SWC path aliases @/ client/ @shared/ shared/ fs restrictions and the Express dev plugin. vite.config.ts vite.config.server.ts defineServerConfig",
  },
  {
    page: "Getting Started",
    path: "/docs",
    section: "TypeScript & Tailwind",
    sectionId: "typescript-tailwind",
    text: "tsconfig.json extends @agent-native/core/tsconfig.base.json tailwind.config.ts import preset from @agent-native/core/tailwind presets content client/**/*.{ts,tsx}",
  },
  {
    page: "Getting Started",
    path: "/docs",
    section: "Subpath Exports",
    sectionId: "subpath-exports",
    text: "@agent-native/core exports createServer createFileWatcher createSSEHandler createProductionServer runScript parseArgs loadEnv fail agentChat sendToAgentChat useAgentChatGenerating useFileWatcher cn. @agent-native/core/vite exports defineConfig defineServerConfig. @agent-native/core/tailwind Tailwind preset HSL colors shadcn/ui tokens animations. @agent-native/core/adapters/sync FileSyncAdapter interface FileRecord FileChange types. @agent-native/core/adapters/firestore FirestoreFileSyncAdapter FileSync threeWayMerge loadSyncConfig. @agent-native/core/adapters/supabase SupabaseFileSyncAdapter FileSync. @agent-native/core/adapters/neon NeonFileSyncAdapter FileSync polling-based sync.",
  },
  {
    page: "Getting Started",
    path: "/docs",
    section: "Architecture Principles",
    sectionId: "architecture-principles",
    text: "Files as database all app state lives in files. Both UI and agent read/write the same files. All AI through agent chat no inline LLM calls. UI delegates to the AI via sendToAgentChat(). Scripts for agent ops pnpm script dispatches to callable script files. Bidirectional SSE events file watcher keeps UI in sync with agent changes in real-time. Agent can update code the agent modifies the app itself.",
  },

  // Server
  {
    page: "Server",
    path: "/docs/server",
    section: "createServer()",
    sectionId: "createserver",
    text: "Creates a pre-configured Express app with standard middleware. Includes cors json limit 50mb urlencoded /api/ping. Options: cors CorsOptions or false CORS config pass false to disable. jsonLimit string JSON body parser limit default 50mb. pingMessage string health check response default env PING_MESSAGE or pong. disablePing boolean disable /api/ping endpoint.",
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
    text: 'Creates an Express route handler that streams file changes as Server-Sent Events. Each SSE message is JSON type change path data/file.json. Options: extraEmitters additional EventEmitters to stream. app.get("/api/events", createSSEHandler(watcher))',
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
    section: "useFileWatcher()",
    sectionId: "usefilewatcher",
    text: "React hook that connects to the SSE endpoint and invalidates react-query caches on file changes. Options: queryClient React-query client for cache invalidation. queryKeys string array query key prefixes to invalidate default file fileTree. eventsUrl string SSE endpoint URL default /api/events. onEvent callback for each SSE event.",
  },
  {
    page: "Client",
    path: "/docs/client",
    section: "cn()",
    sectionId: "cn",
    text: 'Utility for merging class names clsx plus tailwind-merge. cn("px-4 py-2 rounded", isActive && "bg-primary text-primary-foreground", className)',
  },

  // Scripts
  {
    page: "Scripts",
    path: "/docs/scripts",
    section: "Script Dispatcher",
    sectionId: "script-dispatcher",
    text: "The script system lets you create scripts that agents can invoke via pnpm script name. Each script is a TypeScript file that exports a default async function. scripts/run.ts dispatcher one-time setup runScript(). scripts/hello.ts example script.",
  },
  {
    page: "Scripts",
    path: "/docs/scripts",
    section: "parseArgs()",
    sectionId: "parseargs",
    text: 'Parse CLI arguments in --key value or --key=value format. parseArgs(["--name", "Steve", "--verbose", "--count=3"]) returns { name: "Steve", verbose: "true", count: "3" }',
  },
  {
    page: "Scripts",
    path: "/docs/scripts",
    section: "Shared Agent Chat",
    sectionId: "shared-agent-chat",
    text: 'Isomorphic chat bridge that works in both browser and Node.js. agentChat.submit("Generate a report"). agentChat.prefill("Draft an email", contextData). agentChat.send({ message, context, submit }). In the browser messages are sent via window.postMessage(). In Node.js scripts they use the BUILDER_PARENT_MESSAGE stdout format.',
  },
  {
    page: "Scripts",
    path: "/docs/scripts",
    section: "Utility Functions",
    sectionId: "utility-functions",
    text: "loadEnv(path?) load .env from project root or custom path. camelCaseArgs(args) convert kebab-case keys to camelCase. isValidPath(p) validate relative path no traversal no absolute. isValidProjectPath(p) validate project slug. ensureDir(dir) mkdir -p helper. fail(message) print error to stderr and exit(1).",
  },
  {
    page: "Scripts",
    path: "/docs/scripts",
    section: "Database Sync Adapters",
    sectionId: "database-sync-adapters",
    text: "Bidirectional file sync across instances with pluggable database adapters. Supports Google Cloud Firestore Supabase and Neon Postgres. All adapters implement FileSyncAdapter interface. FirestoreFileSyncAdapter real-time via onSnapshot. SupabaseFileSyncAdapter real-time via Supabase Realtime channels. NeonFileSyncAdapter polling-based serverless SQL. Features startup sync remote change listeners chokidar file watchers three-way merge with LCS-based conflict resolution and .conflict sidecar files. Supabase and Neon require a files table migration. Custom adapters via @agent-native/core/adapters/sync.",
  },

  // Harnesses
  {
    page: "Harnesses",
    path: "/docs/harnesses",
    section: "CLI Harness",
    sectionId: "cli-harness",
    text: "Open source ships with @agent-native/harness-cli. Runs locally xterm.js terminal on the left your app iframe on the right. Supports multiple AI coding CLIs Claude Code Codex Gemini CLI OpenCode. Switch between them from the settings panel. Auto-installs missing CLIs on first use. Per-CLI launch flags and settings persisted to localStorage. Best for solo development local testing open-source projects. Quick start pnpm dev:harness",
  },
  {
    page: "Harnesses",
    path: "/docs/harnesses",
    section: "Supported CLIs",
    sectionId: "supported-clis",
    text: "Claude Code claude --dangerously-skip-permissions --resume --verbose. Codex codex --full-auto --quiet. Gemini CLI gemini --sandbox. OpenCode opencode. Switch between CLIs at any time from the settings panel.",
  },
  {
    page: "Harnesses",
    path: "/docs/harnesses",
    section: "Builder Harness",
    sectionId: "builder-harness",
    text: "Provided by Builder.io available at builder.io. Runs locally or in the cloud. Real-time collaboration multiple users can watch interact simultaneously. Visual editing capabilities alongside the AI agent. Parallel agent execution for faster iteration. Best for teams production deployments visual editing real-time collaboration.",
  },
  {
    page: "Harnesses",
    path: "/docs/harnesses",
    section: "Feature Comparison",
    sectionId: "feature-comparison",
    text: "Local development both yes. Cloud/remote CLI no Builder yes. Multi-CLI support CLI yes 4 CLIs Builder yes. Real-time collaboration CLI no Builder yes. Visual editing CLI no Builder yes. Parallel agents CLI no Builder yes. Agent chat bridge both yes. File watcher SSE both yes. Script system both yes. Open source CLI yes Builder no.",
  },
  {
    page: "Harnesses",
    path: "/docs/harnesses",
    section: "How It Works",
    sectionId: "how-it-works",
    text: "Both harnesses support the same core agent-native protocol. Agent chat use sendToAgentChat() to send messages to the agent. Generation state use useAgentChatGenerating() to track when the agent is running. File watching SSE endpoint keeps UI in sync when the agent modifies files. Script system pnpm script dispatches to callable scripts. Your app code is identical regardless of which harness or CLI you use.",
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
    section: "Files as Database",
    sectionId: "files-as-database",
    text: "All application state content data configuration lives in files JSON Markdown YAML in the data directory. No traditional database. Agents are excellent at reading writing grepping navigating file trees. State is versionable with git. App becomes a function of files like React is a function of state.",
  },
  {
    page: "Key Concepts",
    path: "/docs/key-concepts",
    section: "Agent Chat Bridge",
    sectionId: "agent-chat-bridge",
    text: "UI never calls an LLM directly. Sends message to agent via postMessage. Agent has full conversation history skills instructions. Transport is window.parent.postMessage in browser. BUILDER_PARENT_MESSAGE stdout format in Node scripts. sendToAgentChat submit prefill. Everything goes through the agent so any app can be driven from Slack Telegram or another agent.",
  },
  {
    page: "Key Concepts",
    path: "/docs/key-concepts",
    section: "Real-time SSE Sync",
    sectionId: "sse-sync",
    text: "Chokidar file watcher monitors data directory streams changes to browser via Server-Sent Events. useFileWatcher hook invalidates react-query caches. No polling no refresh UI updates instantly when agent acts. createFileWatcher createSSEHandler.",
  },
  {
    page: "Key Concepts",
    path: "/docs/key-concepts",
    section: "Database Adapters",
    sectionId: "database-adapters",
    text: "Pluggable adapter system syncs files to a remote database in real-time. Three adapters ship out of the box: Google Cloud Firestore real-time via onSnapshot. Supabase Postgres real-time via Supabase Realtime channels. Neon Postgres polling-based serverless SQL. All adapters use chokidar file watching three-way merge with LCS-based conflict resolution and .conflict sidecar files. Database is never source of truth files are. Database is sync mechanism for collaboration. Configure which files sync via glob patterns in sync-config.json.",
  },
  {
    page: "Key Concepts",
    path: "/docs/key-concepts",
    section: "Agent Modifies Code",
    sectionId: "agent-modifies-code",
    text: "Agent can edit apps own source code components routes styles scripts. Fork and evolve pattern. Fork a template customize by asking the agent. Add new chart types connect to Stripe write integrations. Combined with git-based workflows roles ACLs for safety.",
  },

  // Creating Templates
  {
    page: "Creating Templates",
    path: "/docs/creating-templates",
    section: "Overview",
    sectionId: "overview",
    text: "Templates are complete forkable agent-native apps that solve a specific use case. Anyone can create a template and share with the community. Good templates solve a real workflow have comprehensive AGENTS.md include scripts follow five rules.",
  },
  {
    page: "Creating Templates",
    path: "/docs/creating-templates",
    section: "Start from the Starter",
    sectionId: "start-from-starter",
    text: "npx @agent-native/core create my-template scaffolds a minimal agent-native app with standard directory structure working dev server file watching SSE example script.",
  },
  {
    page: "Creating Templates",
    path: "/docs/creating-templates",
    section: "Write AGENTS.md",
    sectionId: "write-agents-md",
    text: "Most important file in your template. Tells AI agent how app works what it can and cant do. Include architecture principles directory structure available scripts data model key patterns.",
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
    text: "20+ data connectors BigQuery HubSpot Stripe Jira Sentry GitHub Slack Grafana Google Cloud Apollo Gong Notion. SQL query explorer with history row count tracking shareable URLs export. Reusable dashboards multi-view subviews date range controls. Data dictionary 550+ metrics query templates join patterns. Rich visualizations area charts time series leaderboards kanban boards. 50+ pre-built scripts. Ad-hoc analysis system. Data quality trust scoring.",
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
  {
    page: "Brand Image Generator Template",
    path: "/templates/imagegen",
    section: "AI-Native Brand Image Generator",
    sectionId: "",
    text: "Open source alternative to Canva Brandmark. AI-native brand asset manager. Upload brand logos colors fonts style reference images. AI style profiling analyzes reference images extracts color palettes textures mood composition patterns. On-brand image generation from text prompts matching brand visual style. Batch variations 1-8 style-consistent variations per prompt. Gallery browse download manage generated images. Gemini API powered. npx @agent-native/core create my-app --template imagegen",
  },
];
