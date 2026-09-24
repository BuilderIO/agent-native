import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";

const root = resolve(import.meta.dirname, "..");
const homePath = "templates/chat/app/routes/home.tsx";
const home = readFileSync(join(root, homePath), "utf8");

function checkHome(source: string) {
  const fixture = mkdtempSync(join(tmpdir(), "chat-ui-guard-"));
  try {
    for (const directory of [
      "packages/dispatch/src/components/layout",
      "packages/desktop-app/src/renderer/components",
    ]) {
      mkdirSync(join(fixture, directory), { recursive: true });
    }
    for (const file of [
      homePath,
      "templates/chat/app/components/layout/Sidebar.tsx",
      "templates/chat/app/components/layout/Layout.tsx",
      "templates/chat/app/components/chat/ChatRouteContent.tsx",
      "templates/chat/app/routes/chat.$threadId.tsx",
      "templates/chat/app/root.tsx",
      "templates/chat/app/components/ui/toolkit-provider.tsx",
    ]) {
      mkdirSync(dirname(join(fixture, file)), { recursive: true });
      writeFileSync(
        join(fixture, file),
        file === homePath ? source : readFileSync(join(root, file), "utf8"),
      );
    }
    return spawnSync(
      process.execPath,
      [
        "--import",
        import.meta.resolve("tsx"),
        join(root, "scripts/guard-chat-first-shared-ui.ts"),
      ],
      { cwd: fixture, encoding: "utf8" },
    );
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
}

test("accepts the mount-aware durable Chat home handoff", () => {
  const result = checkHome(home);
  assert.equal(result.status, 0, result.stderr);
});

test("accepts a basename-aware React Router replacement", () => {
  const result = checkHome(
    'import { useNavigate } from "react-router";\n' +
      home.replace(
        "window.location.replace(appPath(`/chat/${encodeURIComponent(threadId)}`));",
        "navigate(`/chat/${encodeURIComponent(threadId)}`, { replace: true });",
      ),
  );
  assert.equal(result.status, 0, result.stderr);
});

test("rejects a full-page handoff that escapes the app mount", () => {
  const result = checkHome(
    home.replace(
      "appPath(`/chat/${encodeURIComponent(threadId)}`)",
      "`/chat/${encodeURIComponent(threadId)}`",
    ),
  );
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /Chat \/home must route a pending thread/);
});

test("requires the shared appPath helper and durable handoff marker", () => {
  for (const missing of [
    'import { appPath } from "@agent-native/core/client/api-path";',
    'markAgentChatHomeHandoff("chat");',
  ]) {
    const result = checkHome(home.replace(missing, ""));
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /Chat \/home must route a pending thread/);
  }
});
