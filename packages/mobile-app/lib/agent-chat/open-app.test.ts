import type { AgentEvent } from "@agent-native/agentkit/protocol";
import type { AppConfig } from "@agent-native/shared-app-config";
import { expect, it } from "vitest";

import {
  readMobileOpenAppEvent,
  mobileAppPanelUnavailable,
  resolveMobileAppPanelTarget,
} from "./open-app";

const mail: AppConfig = {
  id: "mail",
  name: "Mail",
  description: "Mail",
  icon: "mail",
  url: "https://mail.example.test/apps/mail",
  devPort: 3000,
  isBuiltIn: true,
  enabled: true,
};
function updated(name: string, status: string, output?: unknown): AgentEvent {
  return {
    type: "tool.updated",
    id: "event",
    threadId: "thread",
    runId: "run",
    sequence: 1,
    occurredAt: "2026-11-01T12:00:00Z",
    toolCall: { id: "tool", name, status, output },
  } as AgentEvent;
}
it("opens only completed first-party output, never input or namespace lookalikes", () => {
  expect(
    readMobileOpenAppEvent(
      updated(
        "open_app",
        "completed",
        JSON.stringify({ app: "mail", path: "/inbox" }),
      ),
    ),
  ).toEqual({ kind: "open", detail: { app: "mail", path: "/inbox" } });
  for (const name of [
    "remote__open_app",
    "functions.open_app",
    "mcp/open_app",
  ]) {
    expect(
      readMobileOpenAppEvent(
        updated(name, "completed", { app: "mail", path: "/" }),
      ),
    ).toBeNull();
  }
  expect(
    readMobileOpenAppEvent(
      updated("open_app", "running", { app: "mail", path: "/" }),
    ),
  ).toBeNull();
  for (const output of [
    undefined,
    "unreadable",
    {},
    { app: "mail" },
    { app: "mail", path: "/", ok: false },
    { app: "mail", path: "/", isError: true },
  ]) {
    expect(
      readMobileOpenAppEvent(updated("open_app", "completed", output)),
    ).toMatchObject({ kind: "notice" });
  }
  expect(
    readMobileOpenAppEvent(
      updated("open_app", "failed", { app: "mail", path: "/" }),
    ),
  ).toMatchObject({ kind: "notice" });
});
it("resolves registered IDs, links, base paths, queries and views through the shared allow-list", () => {
  expect(
    resolveMobileAppPanelTarget(
      { app: "mail", path: "/thread/qa?panel=read#message" },
      [mail],
    ),
  ).toMatchObject({
    status: "ready",
    target: { app: mail, path: "/apps/mail/thread/qa?panel=read#message" },
  });
  expect(
    resolveMobileAppPanelTarget(
      { url: "https://mail.example.test/apps/mail/thread/qa" },
      [mail],
    ),
  ).toMatchObject({
    status: "ready",
    target: { app: mail, path: "/apps/mail/thread/qa" },
  });
  const view = resolveMobileAppPanelTarget({ app: "mail", view: "inbox" }, [
    mail,
  ]);
  expect(view.status).toBe("ready");
  if (view.status === "ready") {
    expect(view.target.path).toContain("/apps/mail/");
    expect(view.target.path).toContain("view=inbox");
  }
});
it("rejects unknown, disabled, off-origin, off-base and encoded traversal targets", () => {
  for (const detail of [
    { app: "unknown", path: "/" },
    { app: "unknown", url: mail.url },
    { app: "mail", path: "https://other.example.test" },
    { app: "mail", path: "//other.example.test" },
    { app: "mail", path: "/%2e%2e/outside" },
    { app: "mail", url: "https://mail.example.test/apps/mail-other" },
    { app: "mail", url: "https://mail.example.test/outside" },
    { url: "javascript:alert(1)" },
  ])
    expect(resolveMobileAppPanelTarget(detail, [mail])).toMatchObject({
      status: "unresolved",
    });
  expect(
    resolveMobileAppPanelTarget({ app: "mail", path: "/" }, [
      { ...mail, enabled: false },
    ]),
  ).toMatchObject({ status: "unresolved" });
});
it("matches an app by its display name", () => {
  expect(
    resolveMobileAppPanelTarget({ app: "Mail", path: "/" }, [
      { ...mail, id: "workspace-mail" },
    ]),
  ).toMatchObject({
    status: "ready",
    target: { app: { id: "workspace-mail" } },
  });
});

it("localizes panel notices with an English fallback", () => {
  expect(mobileAppPanelUnavailable("fr-FR")).toContain("Impossible");
  expect(mobileAppPanelUnavailable("zh-Hant-TW")).toBe(
    mobileAppPanelUnavailable("zh-TW"),
  );
  expect(mobileAppPanelUnavailable("unknown")).toBe(
    mobileAppPanelUnavailable("en-US"),
  );
});

it("resolves enabled workspace registrations through their secure app route", () => {
  const workspaceApp = { ...mail, id: "workspace-app", isBuiltIn: false };
  expect(
    resolveMobileAppPanelTarget(
      { app: "workspace-app", path: "/inbox" },
      [],
      [workspaceApp],
    ),
  ).toMatchObject({
    status: "ready",
    target: {
      app: workspaceApp,
      workspaceAppId: "workspace-app",
      path: "/apps/mail/inbox",
    },
  });
  expect(
    resolveMobileAppPanelTarget(
      { app: "workspace-app", path: "/" },
      [],
      [{ ...workspaceApp, enabled: false }],
    ),
  ).toMatchObject({ status: "unresolved" });
});
