import { reactRouter } from "@react-router/dev/vite";
import fs from "node:fs";
import path from "node:path";
import { defineConfig } from "@agent-native/core/vite";
import {
  findAgentNativeManifest,
  getLocalArtifactApp,
  type LocalArtifactOptions,
} from "@agent-native/core/local-artifacts";
import type { Plugin } from "vite";
import {
  isLocalComponentWorkspaceStoreFile,
  localComponentWorkspaceStoreDir,
  localComponentWorkspaceStorePath,
  registeredLocalComponentRootsSync,
} from "./shared/local-component-workspaces";

const CONTENT_APP_ID = "content";
const LOCAL_COMPONENTS_MODULE_ID =
  "virtual:agent-native-content-local-components";
const RESOLVED_LOCAL_COMPONENTS_MODULE_ID = `\0${LOCAL_COMPONENTS_MODULE_ID}`;
const LOCAL_COMPONENTS_STUB_IMPORTS = new Set([
  "./local-components.generated",
  "./local-components.generated.ts",
]);
const COMPONENT_EXTENSIONS = new Set([".tsx", ".jsx", ".ts", ".js"]);
const CONTENT_LOCAL_DEFAULTS: LocalArtifactOptions["defaults"] = {
  roots: [
    { name: "Docs", path: "docs", kind: "docs", extensions: [".md", ".mdx"] },
    { name: "Blog", path: "blog", kind: "blog", extensions: [".md", ".mdx"] },
    {
      name: "Content",
      path: "content",
      kind: "content",
      extensions: [".md", ".mdx"],
    },
    {
      name: "Resources",
      path: "resources",
      kind: "resources",
      extensions: [".md", ".mdx"],
    },
  ],
  components: "components",
  hide: ["**/_*.md", "**/_*.mdx"],
};

function normalizeSlash(value: string) {
  return value.replace(/\\/g, "/");
}

function envManifestPath() {
  return (
    process.env.AGENT_NATIVE_MANIFEST?.trim() ||
    process.env.AGENT_NATIVE_MANIFEST_PATH?.trim() ||
    ""
  );
}

function localWorkspaceRootSync() {
  const manifestPath = envManifestPath() || findAgentNativeManifest();
  if (!manifestPath) return null;
  const workspaceRoot = path.dirname(path.resolve(process.cwd(), manifestPath));
  try {
    return fs.realpathSync(workspaceRoot);
  } catch {
    return workspaceRoot;
  }
}

function normalizeRelativePath(filePath: string, label: string) {
  if (!filePath || typeof filePath !== "string") {
    throw new Error(`${label} is required`);
  }
  if (filePath.includes("\0") || path.isAbsolute(filePath)) {
    throw new Error(`${label} must be a safe relative path`);
  }
  const normalized = normalizeSlash(
    path.posix.normalize(normalizeSlash(filePath)),
  );
  if (
    !normalized ||
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw new Error(`${label} must be a safe relative path`);
  }
  return normalized;
}

function pascalCase(value: string) {
  return value
    .replace(/\.[^.]+$/, "")
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

function componentNameForFile(filePath: string) {
  const basename = path.basename(filePath);
  if (!/^index\.[^.]+$/.test(basename)) return pascalCase(basename);
  return pascalCase(path.basename(path.dirname(filePath)));
}

function renderComponentRegistration(
  moduleName: string,
  componentName: string,
  valueExpression: string,
) {
  return `registerComponent(${JSON.stringify(componentName)}, ${valueExpression}, ${moduleName});`;
}

async function walkComponentFiles(directory: string): Promise<string[]> {
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (entry.isSymbolicLink()) continue;
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (
        entry.name === "node_modules" ||
        entry.name === "dist" ||
        entry.name === "build"
      ) {
        continue;
      }
      files.push(...(await walkComponentFiles(absolutePath)));
      continue;
    }
    if (
      !entry.isFile() ||
      !COMPONENT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())
    ) {
      continue;
    }
    files.push(absolutePath);
  }
  return files.sort((a, b) => a.localeCompare(b));
}

async function localComponentDirs() {
  const app = await getLocalArtifactApp({
    appId: CONTENT_APP_ID,
    defaults: CONTENT_LOCAL_DEFAULTS,
  });

  const dirs: string[] = [];
  if (app.mode === "local-files") {
    const workspaceRoot = fs.realpathSync(app.workspaceRoot);
    for (const componentPath of app.components) {
      const safePath = normalizeRelativePath(componentPath, "components path");
      const absolutePath = path.resolve(workspaceRoot, safePath);
      const relative = path.relative(workspaceRoot, absolutePath);
      if (relative.startsWith("..") || path.isAbsolute(relative)) {
        throw new Error(
          `components path "${componentPath}" is outside workspace`,
        );
      }
      dirs.push(absolutePath);
    }
  }

  try {
    dirs.push(...registeredLocalComponentRootsSync());
  } catch {
    // Dynamic local component folders are a local-dev bridge only. Ignore them
    // when the runtime disallows local file access, such as normal production.
  }

  return [...new Set(dirs.map((dir) => path.resolve(dir)))];
}

async function loadLocalComponentFiles() {
  const dirs = await localComponentDirs();
  return (await Promise.all(dirs.map(walkComponentFiles))).flat();
}

function renderLocalComponentsModule(files: string[]) {
  const imports: string[] = [];
  const assignments: string[] = [
    "const components = {};",
    "const componentInputs = {};",
    `function isComponent(value) {
  return (
    typeof value === "function" ||
    (value && typeof value === "object" && "$$typeof" in value)
  );
}`,
    `function componentInputsFor(name, component, module) {
  return (
    module[\`\${name}Inputs\`] ??
    module[\`\${name}Schema\`]?.inputs ??
    module[\`\${name}Config\`]?.inputs ??
    component?.inputs ??
    module.agentNative?.components?.[name]?.inputs ??
    module.agentNative?.inputs
  );
}`,
    `function registerComponent(name, component, module) {
  if (!isComponent(component)) return;
  components[name] = component;
  const inputs = componentInputsFor(name, component, module);
  if (inputs) componentInputs[name] = inputs;
}`,
  ];
  files.forEach((filePath, index) => {
    const variableName = `module${index}`;
    const componentName = componentNameForFile(filePath);
    imports.push(
      `import * as ${variableName} from ${JSON.stringify(
        `/@fs/${normalizeSlash(filePath)}`,
      )};`,
    );
    assignments.push(`{
  const named = ${JSON.stringify(componentName)};
  const candidate = ${variableName}[named] ?? ${variableName}.default;
  ${renderComponentRegistration(variableName, componentName, "candidate")}
  for (const [exportName, value] of Object.entries(${variableName})) {
    if (/^[A-Z]/.test(exportName)) registerComponent(exportName, value, ${variableName});
  }
}`);
  });

  return `${imports.join("\n")}
${assignments.join("\n")}
export const localContentComponentInputs = componentInputs;
export const localContentComponents = components;
export default components;
`;
}

function isInsideDirectory(directory: string, candidate: string) {
  const relative = path.relative(directory, candidate);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

function isLocalComponentsStubImport(id: string, importer?: string) {
  if (id === LOCAL_COMPONENTS_MODULE_ID) return true;
  if (!importer || !LOCAL_COMPONENTS_STUB_IMPORTS.has(id)) return false;
  return normalizeSlash(importer)
    .split("?")[0]
    .endsWith("/app/local-components.ts");
}

function contentLocalComponentsPlugin(): Plugin {
  return {
    name: "agent-native-content-local-components",
    enforce: "pre",
    async configureServer(server) {
      const registryDir = localComponentWorkspaceStoreDir();
      const legacyRegistryPath = localComponentWorkspaceStorePath();
      let dirs = new Set<string>();
      let refreshPromise: Promise<void> | null = null;
      let refreshAgain = false;
      const runRefreshDirs = async () => {
        const nextDirs = new Set(await localComponentDirs());
        const newDirs = [...nextDirs].filter((dir) => !dirs.has(dir));
        if (newDirs.length > 0) {
          server.watcher.add(newDirs);
          const allow = server.config.server.fs.allow ?? [];
          for (const dir of newDirs) {
            if (!allow.includes(dir)) allow.push(dir);
          }
        }
        dirs = nextDirs;
      };
      const refreshDirs = async () => {
        if (refreshPromise) {
          refreshAgain = true;
          return refreshPromise;
        }
        refreshPromise = (async () => {
          do {
            refreshAgain = false;
            await runRefreshDirs();
          } while (refreshAgain);
        })().finally(() => {
          refreshPromise = null;
        });
        return refreshPromise;
      };
      const invalidateComponents = (fullReload = false) => {
        const mod = server.moduleGraph.getModuleById(
          RESOLVED_LOCAL_COMPONENTS_MODULE_ID,
        );
        if (mod) server.moduleGraph.invalidateModule(mod);
        if (fullReload) server.ws.send({ type: "full-reload" });
      };

      await fs.promises.mkdir(registryDir, { recursive: true });
      server.watcher.add([registryDir, legacyRegistryPath]);
      await refreshDirs();
      server.watcher.on("all", async (eventName, changedPath) => {
        const resolvedChangedPath = path.resolve(changedPath);
        if (
          path.dirname(resolvedChangedPath) === path.resolve(registryDir) &&
          isLocalComponentWorkspaceStoreFile(resolvedChangedPath)
        ) {
          await refreshDirs();
          invalidateComponents(true);
          return;
        }
        if (
          !["add", "unlink", "addDir", "unlinkDir"].includes(eventName) ||
          ![...dirs].some((dir) => isInsideDirectory(dir, resolvedChangedPath))
        ) {
          return;
        }
        await refreshDirs();
        invalidateComponents(true);
      });
    },
    resolveId(id, importer) {
      if (isLocalComponentsStubImport(id, importer)) {
        return RESOLVED_LOCAL_COMPONENTS_MODULE_ID;
      }
      return null;
    },
    async load(id) {
      if (id !== RESOLVED_LOCAL_COMPONENTS_MODULE_ID) return null;
      return renderLocalComponentsModule(await loadLocalComponentFiles());
    },
  };
}

const localWorkspaceRoot = localWorkspaceRootSync();
const dynamicLocalComponentDirs = (() => {
  try {
    return registeredLocalComponentRootsSync();
  } catch {
    return [];
  }
})();

const cloudflareSsrStubs =
  process.env.NITRO_PRESET === "cloudflare_pages"
    ? [
        "@assistant-ui/react",
        "@tiptap/core",
        "@tiptap/extension-blockquote",
        "@tiptap/extension-code-block-lowlight",
        "@tiptap/extension-collaboration",
        "@tiptap/extension-collaboration-caret",
        "@tiptap/extension-image",
        "@tiptap/extension-link",
        "@tiptap/extension-placeholder",
        "@tiptap/extension-table",
        "@tiptap/extension-table-cell",
        "@tiptap/extension-table-header",
        "@tiptap/extension-table-row",
        "@tiptap/extension-task-item",
        "@tiptap/extension-task-list",
        "@tiptap/pm",
        "@tiptap/react",
        "@tiptap/starter-kit",
        "@xterm/addon-fit",
        "@xterm/addon-web-links",
        "@xterm/xterm",
        "katex",
        "lowlight",
        "prettier",
        "react-markdown",
        "remark-gfm",
        "remark-mdx",
        "tiptap-markdown",
        "yjs",
        "y-protocols",
      ]
    : [];

export default defineConfig({
  plugins: [contentLocalComponentsPlugin(), reactRouter()],
  fsAllow: [
    ...(localWorkspaceRoot ? [localWorkspaceRoot] : []),
    ...dynamicLocalComponentDirs,
  ],
  // shiki only runs in AssistantChat's useEffect — keep it out of the
  // CF Pages Functions bundle (25 MiB limit).
  ssrStubs: ["shiki", ...cloudflareSsrStubs],
  optimizeDeps: {
    include: [
      "yjs",
      "y-protocols/awareness",
      "@tiptap/core",
      "@tiptap/extension-collaboration",
      "@tiptap/extension-collaboration-caret",
      "@tiptap/y-tiptap",
    ],
  },
});
