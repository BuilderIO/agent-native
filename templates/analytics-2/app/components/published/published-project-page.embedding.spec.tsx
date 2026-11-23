// @vitest-environment happy-dom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import messages from "@/i18n/en-US";
import { projectDocumentSchema } from "@/lib/model/contracts";
import { resolveRoute } from "@/routes/routing/registry";

import { applyAppPatches, emptyAppLayout } from "../../../shared/app-layout";
import type { PresignedEmbedTokenVerification } from "../../../shared/app-embedding";
import { revisionSchema } from "../../../shared/notebook-snapshot-contract";
import { projectDocumentWithLayoutSchema } from "../../../shared/project-document";

const mockState = vi.hoisted(() => ({
  allowEmbedding: false,
  verifyResult: {
    valid: true,
    projectId: "prj_1",
    expiresAt: "2026-11-22T12:00:00.000Z",
    userAttributes: { team: "growth" },
    reason: "ok",
  } as PresignedEmbedTokenVerification,
  verifyPending: false,
}));

vi.mock("@tanstack/react-query", () => ({
  useQueries: () => [],
  useQueryClient: () => ({ invalidateQueries: vi.fn(async () => {}) }),
}));

vi.mock("@/components/sharing/PublishedAppSharePopover", () => ({
  PublishedAppSharePopover: () => <button type="button">Share</button>,
}));

vi.mock("@agent-native/core/client/hooks", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@agent-native/core/client/hooks")>();
  return {
    ...actual,
    actionErrorCode: () => undefined,
    actionErrorMessage: () => undefined,
    useActionMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useActionQuery: (name: string) => {
      if (name === "verify-presigned-embed-token") {
        return {
          data: mockState.verifyPending ? undefined : mockState.verifyResult,
          isPending: mockState.verifyPending,
          isError: false,
        };
      }
      return { data: undefined, isPending: false, isError: false };
    },
  };
});

vi.mock("./usePublishedAppSession", () => ({
  usePublishedAppSession: () => {
    const base = projectDocumentSchema.parse({
      id: "prj_1",
      ownerEmail: "owner@example.test",
      title: "Embedded Revenue App",
      description: "",
      language: "python",
      statusId: null,
      favorited: false,
      allowEmbedding: mockState.allowEmbedding,
      trashedAt: null,
      archivedAt: null,
      lastOpenedAt: null,
      createdAt: "2026-11-15T00:00:00.000Z",
      updatedAt: "2026-11-15T00:00:00.000Z",
      workingVersionId: "ver_working",
      publishedVersionId: "ver_published",
      collectionIds: [],
      cells: [
        {
          id: "c1",
          projectId: "prj_1",
          versionId: "ver_published",
          createdAt: "2026-11-15T00:00:00.000Z",
          updatedAt: "2026-11-15T00:00:00.000Z",
          contents: {
            id: "c1",
            order: "a1",
            kind: "text",
            label: "Headline",
            text: "Quarterly ARR summary",
            hidden: false,
            gridX: null,
            gridY: null,
            gridWidth: null,
            gridHeight: null,
          },
        },
      ],
    });
    const layout = applyAppPatches(
      emptyAppLayout(revisionSchema.parse("0")),
      [{ type: "initialize" }],
      base.cells,
    );
    const projected = projectDocumentWithLayoutSchema.parse({
      ...base,
      appLayout: layout,
    });
    return {
      loading: false,
      accessDenied: false,
      error: null,
      values: {},
      retry: vi.fn(),
      refresh: vi.fn(),
      reset: vi.fn(),
      changeInput: vi.fn(),
      commitInput: vi.fn(),
      commitInputs: vi.fn(),
      saveView: vi.fn(),
      session: {
        sessionId: "ses_1",
        releaseId: "rel_1",
        sessionHref: "/app/prj_1/latest",
        revision: revisionSchema.parse("1"),
        state: "ready",
        ageStatus: "fresh",
        refreshedAt: "2026-11-22T00:00:00.000Z",
        refreshUnavailable: false,
        staleAfter: { kind: "hours", value: 24 },
        overrides: {},
        inputChoices: {},
        caps: {
          refreshDefault: true,
          editNotebook: true,
          manageAppSharing: true,
          manageSchedules: false,
        },
        projection: {
          project: projected,
          outputs: {},
          metricSourceResultIds: {},
          runningCellIds: [],
          canViewSource: true,
          tabSlugs: [],
        },
      },
    };
  },
}));

import { PublishedProjectPage } from "./PublishedProjectPage";

describe("PublishedProjectPage embedding modes", () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    mockState.allowEmbedding = false;
    mockState.verifyPending = false;
    mockState.verifyResult = {
      valid: true,
      projectId: "prj_1",
      expiresAt: "2026-11-22T12:00:00.000Z",
      userAttributes: { team: "growth" },
      reason: "ok",
    };
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  async function renderAt(url: string) {
    const resolved = resolveRoute(url);
    if (!resolved) throw new Error(`Route did not resolve: ${url}`);
    await act(async () => {
      root.render(
        <AgentNativeI18nProvider catalog={{ messages }} persistPreference={false}>
          <MemoryRouter initialEntries={[url]}>
            <PublishedProjectPage route={resolved} />
          </MemoryRouter>
        </AgentNativeI18nProvider>,
      );
    });
  }

  it("renders full app chromeless when ?embedded=true is set", async () => {
    await renderAt("/app/prj_1/latest?embedded=true");
    const main = host.querySelector("main[data-published-app='true']");
    expect(main?.getAttribute("data-embedded")).toBe("true");
    expect(host.querySelector("header.app-session-header")).toBeNull();
    expect(host.textContent).toContain("Quarterly ARR summary");
  });

  it("verifies signed embed tokens and marks signed embed active when valid", async () => {
    mockState.allowEmbedding = true;
    await renderAt(
      "/app/prj_1/latest?embedded=true&embedToken=emb_valid_token_1234567890",
    );
    const main = host.querySelector("main[data-published-app='true']");
    expect(main?.getAttribute("data-embedded")).toBe("true");
    expect(main?.getAttribute("data-signed-embed")).toBe("true");
    expect(host.querySelector("header.app-session-header")).toBeNull();
  });

  it("blocks embedded rendering when a signed embed token is expired", async () => {
    mockState.allowEmbedding = true;
    mockState.verifyResult = {
      valid: false,
      projectId: "prj_1",
      expiresAt: null,
      userAttributes: {},
      reason: "expired",
    };
    await renderAt(
      "/app/prj_1/latest?embedded=true&embedToken=emb_expired_token_1234567890",
    );
    const err = host.querySelector("[data-embed-error='expired']");
    expect(err).not.toBeNull();
    expect(host.textContent).toContain("expired");
  });

  it("displays the signed embedding notice when opening a signed-embed app directly", async () => {
    mockState.allowEmbedding = true;
    await renderAt("/app/prj_1/latest");
    const banner = host.querySelector("[data-signed-embed-banner='true']");
    expect(banner).not.toBeNull();
    expect(banner?.textContent).toContain("Signed embedding enabled");
  });
});
