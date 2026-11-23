#!/usr/bin/env node
// A stateful surface (the chat, a composer, an editor) served by TWO sibling route
// modules is a trap: navigating from the bare route to its :id route swaps the
// route branch, React remounts the surface, and anything in flight is dropped.
// Measured in automations-2: typing a prompt saved the thread and the message,
// generated a title, and never started the run - the composer element was replaced
// the moment the URL gained a thread id. The reader saw their prompt with no reply
// and no error.
//
// The rule: a route that renders a stateful surface either has no `:param` sibling
// that renders the same surface, or serves both paths from one module with an
// optional segment (`chat.($threadId).tsx`), or keeps the surface in a layout whose
// children are the ones that change (an Outlet).
//
// Usage: node packages/toolkit/scripts/check-route-surface-remount.mjs [--root <repo>] [--json]
// Exit 0 clean, 1 findings, 2 usage/scan error.
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);

if (args.includes("--self-test")) {
  // Build three throwaway app trees: the hazard, the optional-segment fix and the
  // layout fix. The check must report exactly the first one.
  const os = await import("node:os");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "route-remount-"));
  const write = (rel, body) => {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
  };
  const surface =
    'import { AgentChatSurface } from "@agent-native/toolkit/app/chat";\nexport default function R() { return <AgentChatSurface mode="page" />; }\n';
  write("templates/hazard/app/routes/chat._index.tsx", surface);
  write("templates/hazard/app/routes/chat.$threadId.tsx", surface);
  write("templates/optional/app/routes/chat.($threadId).tsx", surface);
  write(
    "templates/layout/app/routes/chat.tsx",
    'import { Outlet } from "react-router";\nexport default function L() { return <Outlet />; }\n',
  );
  write("templates/layout/app/routes/chat.$threadId.tsx", surface);
  const run = (await import("node:child_process")).spawnSync(
    process.execPath,
    [process.argv[1], "--root", dir, "--json"],
    { encoding: "utf8" },
  );
  const parsed = JSON.parse(run.stdout);
  const apps = parsed.findings.map((f) => f.app);
  const ok = apps.length === 1 && apps[0] === "hazard";
  console.log(
    ok ? "self-test: PASS" : `self-test: FAIL ${JSON.stringify(apps)}`,
  );
  fs.rmSync(dir, { recursive: true, force: true });
  process.exit(ok ? 0 : 1);
}
const rootFlag = args.indexOf("--root");
const repo =
  rootFlag >= 0 ? path.resolve(args[rootFlag + 1] ?? ".") : process.cwd();
const asJson = args.includes("--json");
const TEMPLATES = path.join(repo, "templates");
if (!fs.existsSync(TEMPLATES)) {
  console.error(`no templates directory under ${repo}`);
  process.exit(2);
}

// Components whose mount owns in-flight state worth protecting.
const SURFACE =
  /AgentChatSurface|AgentPanel|ChatRouteContent|CoreAgentKitRoot|PromptComposer/;
const ROUTES = /^(chat|assistant|ask)$/;

const findings = [];

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function describesSurface(source) {
  return SURFACE.test(stripComments(source));
}

for (const app of fs.readdirSync(TEMPLATES)) {
  const routesDir = path.join(TEMPLATES, app, "app", "routes");
  if (!fs.existsSync(routesDir)) continue;
  const files = fs
    .readdirSync(routesDir)
    .filter((f) => /\.tsx$/.test(f) && !/\.(spec|test)\./.test(f));
  const bare = files.filter((f) => {
    const base = f.replace(/\.tsx$/, "");
    // `chat.tsx`, `chat._index.tsx` and an optional-segment `chat.($id).tsx` are the
    // landing shapes; a plain `chat.tsx` is the one that clashes with a child.
    return ROUTES.test(base) || base === `${base.split(".")[0]}._index`;
  });
  const dynamic = files.filter((f) => /\.[$]/.test(f) && !/\.\([$]/.test(f));
  for (const landing of bare) {
    const name = landing.replace(/\.tsx$/, "").split(".")[0];
    const landingSurface = describesSurface(
      read(path.join(routesDir, landing)),
    );
    const landingLayout = /Outlet/.test(
      stripComments(read(path.join(routesDir, landing))),
    );
    if (!landingSurface || landingLayout) continue;
    for (const child of dynamic) {
      const childName = child.replace(/\.tsx$/, "").split(".")[0];
      if (childName !== name) continue;
      const childSource = stripComments(read(path.join(routesDir, child)));
      if (!describesSurface(childSource)) continue;
      findings.push({
        app,
        files: [
          `templates/${app}/app/routes/${landing}`,
          `templates/${app}/app/routes/${child}`,
        ],
        why: `both routes render a stateful surface with no layout between them, so the ${name}/:id URL change remounts it and can drop a submission in flight`,
      });
    }
  }
}

if (asJson) {
  console.log(JSON.stringify({ findings }, null, 1));
} else {
  const byApp = new Map();
  for (const f of findings) byApp.set(f.app, (byApp.get(f.app) ?? 0) + 1);
  for (const [app, count] of [...byApp].sort((a, b) => b[1] - a[1]))
    console.log(`${app}: ${count}`);
  for (const f of findings) console.log(`${f.files.join(" + ")}  ${f.why}`);
  console.log(
    findings.length === 0
      ? "clean: no stateful surface is served by two sibling route modules"
      : `${findings.length} surface(s) across ${byApp.size} app(s) are served by two sibling route modules - serve both paths from one module with an optional segment, or keep the surface in a layout`,
  );
}
process.exit(findings.length === 0 ? 0 : 1);
