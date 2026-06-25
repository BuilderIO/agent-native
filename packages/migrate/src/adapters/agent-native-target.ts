import fs from "fs/promises";
import path from "path";

import type {
  MigrationContext,
  TargetAdapter,
  TargetAdapterResult,
  VerifierResult,
} from "../types.js";

export const agentNativeTargetAdapter: TargetAdapter = {
  id: "agent-native",
  label: "Agent-Native",
  scaffold: scaffoldAgentNativeTarget,
  verify: async (context) => [
    await verifyAgentNativeConformance(context),
    await verifyOutputFiles(context),
  ],
};

export async function scaffoldAgentNativeTarget(
  context: MigrationContext,
): Promise<TargetAdapterResult> {
  if (!context.run.approved) {
    return {
      ok: false,
      summary: "Migration output writes require plan approval first.",
      changedFiles: [],
      artifactPaths: [],
    };
  }

  const outputRoot = context.run.outputRoot;
  await fs.mkdir(outputRoot, { recursive: true });

  const changedFiles: string[] = [];
  const write = async (relativePath: string, content: string) => {
    const filePath = path.join(outputRoot, relativePath);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content);
    changedFiles.push(relativePath);
  };

  await write("package.json", packageJson());
  await write("AGENTS.md", agentsMd());
  await write("tsconfig.json", tsconfigJson());
  await write("react-router.config.ts", reactRouterConfig());
  await write("vite.config.ts", viteConfig());
  await write(
    "actions/run.ts",
    'import { runScript } from "@agent-native/core/scripts";\nrunScript();\n',
  );
  await write("actions/view-screen.ts", viewScreenAction());
  await write("actions/navigate.ts", navigateAction());
  await write("server/plugins/auth.ts", authPlugin());
  await write("server/plugins/agent-chat.ts", agentChatPlugin());
  await write("server/routes/[...page].get.ts", ssrRoute());
  await write("ssr-entry.ts", ssrEntry());
  await write("app/routes.ts", routesTs());
  await write("app/entry.server.tsx", entryServerTsx());
  await write("app/root.tsx", rootTsx());
  await write("app/global.css", globalCss());
  await write("app/routes/_index.tsx", indexRoute(context));

  for (const route of context.ir.site.routes.filter((r) => r.kind !== "api")) {
    const routeFile = route.path === "/" ? null : routeToFile(route.path);
    if (!routeFile) continue;
    await write(
      routeFile,
      generatedRoute(route.path, route.filePath, route.public),
    );
  }

  const manifestPath = path.join(
    context.artifacts.runDir,
    "generated-files.json",
  );
  await fs.writeFile(
    manifestPath,
    JSON.stringify(changedFiles, null, 2) + "\n",
  );

  return {
    ok: true,
    summary: `Scaffolded agent-native output with ${changedFiles.length} files.`,
    changedFiles,
    artifactPaths: [manifestPath],
  };
}

export async function verifyAgentNativeConformance(
  context: MigrationContext,
): Promise<VerifierResult> {
  const requiredFiles = [
    "actions/run.ts",
    "actions/view-screen.ts",
    "actions/navigate.ts",
    "app/root.tsx",
    "server/plugins/agent-chat.ts",
  ];
  const missing: string[] = [];
  for (const file of requiredFiles) {
    try {
      await fs.access(path.join(context.run.outputRoot, file));
    } catch {
      missing.push(file);
    }
  }
  return {
    id: "agent-native-conformance",
    ok: missing.length === 0,
    severity: missing.length === 0 ? "info" : "error",
    summary:
      missing.length === 0
        ? "Generated output has required agent-native action, app-state, and chat integration files."
        : `Generated output is missing required files: ${missing.join(", ")}`,
    artifactPaths: [],
    suggestedNextTask:
      missing.length > 0 ? "Re-run target scaffold after approval." : undefined,
  };
}

async function verifyOutputFiles(
  context: MigrationContext,
): Promise<VerifierResult> {
  try {
    const stat = await fs.stat(context.run.outputRoot);
    return {
      id: "output-files",
      ok: stat.isDirectory(),
      severity: stat.isDirectory() ? "info" : "error",
      summary: stat.isDirectory()
        ? "Generated output directory exists."
        : "Generated output path is not a directory.",
      artifactPaths: [],
    };
  } catch {
    return {
      id: "output-files",
      ok: false,
      severity: "error",
      summary: "Generated output directory does not exist.",
      artifactPaths: [],
      suggestedNextTask: "Run the approved scaffold step.",
    };
  }
}

function routeToFile(routePath: string): string {
  const normalized = routePath
    .replace(/^\//, "")
    .replace(/[:*]/g, "$")
    .replace(/\//g, ".");
  return `app/routes/${normalized}.tsx`;
}

function packageJson(): string {
  return `${JSON.stringify(
    {
      name: "migrated-agent-native-app",
      private: true,
      type: "module",
      scripts: {
        dev: "agent-native dev --open",
        build: "agent-native build",
        start: "agent-native start",
        typecheck: "agent-native typecheck",
        action: "agent-native action",
      },
      dependencies: {
        "@agent-native/core": "latest",
        "@tabler/icons-react": "^3.41.1",
        "@tanstack/react-query": "^5.99.2",
        "@vitejs/plugin-react": "^6.0.1",
        h3: "^2.0.1-rc.20",
        isbot: "^5",
        "next-themes": "^0.4.6",
        react: "^19.2.7",
        "react-dom": "^19.2.7",
        "react-router": "^8.0.1",
        zod: "^4.3.6",
      },
      devDependencies: {
        "@react-router/dev": "^8.0.1",
        "@react-router/fs-routes": "^8.0.1",
        "@tailwindcss/vite": "^4.2.4",
        "@types/node": "^25.8.0",
        "@types/react": "^19.2.14",
        "@types/react-dom": "^19.2.3",
        typescript: "^6.0.3",
        vite: "8.1.0",
      },
    },
    null,
    2,
  )}\n`;
}

function agentsMd(): string {
  return `# Migrated Agent-Native App

This app was scaffolded by Migration Workbench. Complete each migration task through actions, keep app-owned data in SQL, expose navigation state through application_state, and use actions as the shared UI/agent operation layer.
`;
}

function tsconfigJson(): string {
  return `{
  "extends": "@agent-native/core/tsconfig.base.json",
  "compilerOptions": {
    "ignoreDeprecations": "6.0",
    "rootDirs": [".", "./.react-router/types"],
    "baseUrl": ".",
    "paths": {
      "@/*": ["./app/*"]
    }
  },
  "include": ["app/**/*", "server/**/*", "actions/**/*", "vite.config.ts", "react-router.config.ts", ".react-router/types/**/*"]
}
`;
}

function reactRouterConfig(): string {
  return `import type { Config } from "@react-router/dev/config";

export default {
  appDirectory: "app",
  ssr: true,
  routeDiscovery: { mode: "initial" },
} satisfies Config;
`;
}

function viteConfig(): string {
  return `import { reactRouter } from "@react-router/dev/vite";
import { agentNative } from "@agent-native/core/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    reactRouter(),
    agentNative({
      ssrStubs: ["shiki"],
    }),
  ],
});
`;
}

function viewScreenAction(): string {
  return `import { defineAction } from "@agent-native/core";
import { readAppState } from "@agent-native/core/application-state";
import { z } from "zod";

export default defineAction({
  description: "See the current migrated app screen.",
  schema: z.object({}),
  http: false,
  run: async () => {
    const navigation = await readAppState("navigation");
    return { navigation };
  },
});
`;
}

function navigateAction(): string {
  return `import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { z } from "zod";

export default defineAction({
  description: "Navigate the migrated app UI.",
  schema: z.object({
    view: z.string().optional(),
    path: z.string().optional(),
  }),
  http: false,
  run: async (args) => {
    await writeAppState("navigate", args);
    return { ok: true };
  },
});
`;
}

function authPlugin(): string {
  return `import { createAuthPlugin } from "@agent-native/core/server";

export default createAuthPlugin({
  marketing: {
    appName: "Migrated Agent-Native App",
    tagline: "An agent-native application generated by Migration Workbench.",
    features: ["Actions as tools and endpoints", "SQL-backed state", "Agent-aware navigation"],
  },
});
`;
}

function agentChatPlugin(): string {
  return `import { createAgentChatPlugin, loadActionsFromStaticRegistry } from "@agent-native/core/server";
import { getOrgContext } from "@agent-native/core/org";
import actionsRegistry from "../../.generated/actions-registry.js";

export default createAgentChatPlugin({
  appId: "migrated-app",
  actions: loadActionsFromStaticRegistry(actionsRegistry),
  resolveOrgId: async (event) => (await getOrgContext(event)).orgId,
});
`;
}

function ssrRoute(): string {
  return `import { createH3SSRHandler } from "@agent-native/core/server/ssr-handler";

export default createH3SSRHandler(() => import("virtual:react-router/server-build"));
`;
}

function ssrEntry(): string {
  return `import { createRequestHandler } from "react-router";

const handler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
);

export default {
  async fetch(request: Request) {
    return handler(request);
  },
};
`;
}

function routesTs(): string {
  return `import { type RouteConfig } from "@react-router/dev/routes";
import { flatRoutes } from "@react-router/fs-routes";

export default flatRoutes() satisfies RouteConfig;
`;
}

function entryServerTsx(): string {
  return `import type { EntryContext, RouterContextProvider } from "react-router";
import { ServerRouter } from "react-router";
import ReactDOMServer from "react-dom/server.browser";
const { renderToReadableStream } = ReactDOMServer;
import { isbot } from "isbot";
import { wrapWithAnalytics } from "@agent-native/core/server";

export const streamTimeout = 5_000;

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
  _loadContext: RouterContextProvider,
) {
  if (request.method.toUpperCase() === "HEAD") {
    return new Response(null, {
      status: responseStatusCode,
      headers: responseHeaders,
    });
  }

  const userAgent = request.headers.get("user-agent");
  const waitForAll = (userAgent && isbot(userAgent)) || routerContext.isSpaMode;

  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), streamTimeout);

  try {
    const body = await renderToReadableStream(
      <ServerRouter context={routerContext} url={request.url} />,
      {
        signal: abortController.signal,
        onError(error: unknown) {
          if (!abortController.signal.aborted) {
            responseStatusCode = 500;
            console.error(error);
          }
        },
      },
    );

    if (waitForAll) {
      await body.allReady;
    }

    responseHeaders.set("Content-Type", "text/html");
    return new Response(wrapWithAnalytics(body), {
      headers: responseHeaders,
      status: responseStatusCode,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}
`;
}

function rootTsx(): string {
  return `import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { ClientOnly, DefaultSpinner } from "@agent-native/core/client";
import { AgentSidebar } from "@agent-native/core/client";
import stylesheet from "./global.css?url";
import type { ReactNode } from "react";
import type { LinksFunction } from "react-router";

export const links: LinksFunction = () => [{ rel: "stylesheet", href: stylesheet }];

export function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function Root() {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <ClientOnly fallback={<DefaultSpinner />}>
      <QueryClientProvider client={queryClient}>
        <AgentSidebar position="right" defaultOpen>
          <Outlet />
        </AgentSidebar>
      </QueryClientProvider>
    </ClientOnly>
  );
}
`;
}

function globalCss(): string {
  return `@import "@agent-native/core/styles/agent-native.css";
`;
}

function indexRoute(context: MigrationContext): string {
  return `export default function IndexPage() {
  return (
    <main style={{ padding: 32, fontFamily: "system-ui, sans-serif" }}>
      <h1>Migrated Agent-Native App</h1>
      <p>Migration run: ${context.run.id}</p>
      <p>Routes inventoried: ${context.ir.site.routes.length}</p>
    </main>
  );
}
`;
}

function generatedRoute(
  routePath: string,
  sourceFile: string,
  isPublic: boolean,
): string {
  // Emit dynamic strings as JSON-stringified JSX expressions so route paths
  // containing JSX-significant characters (`{`, `}`, `<`, `>`, `&`) or
  // template-literal terminators (backticks, `${`) can't break the outer
  // generated file. Next.js routes legitimately contain `[slug]`, `(group)`,
  // and `@parallel` segments; any of those slipping into JSX text un-escaped
  // would produce invalid TS.
  const routePathExpr = JSON.stringify(routePath);
  const sourceFileExpr = JSON.stringify(sourceFile);
  return `export default function MigratedRoute() {
  return (
    <main style={{ padding: 32, fontFamily: "system-ui, sans-serif" }}>
      <p style={{ textTransform: "uppercase", fontSize: 12, letterSpacing: 1, color: "#666" }}>
        ${isPublic ? "Public SSR route" : "Logged-in app route"}
      </p>
      <h1>{${routePathExpr}}</h1>
      <p>Source: <code>{${sourceFileExpr}}</code></p>
      <p>This route is a scaffolded migration placeholder. Continue the recipe sweep to port UI, actions, SQL, and app-state behavior.</p>
    </main>
  );
}
`;
}
