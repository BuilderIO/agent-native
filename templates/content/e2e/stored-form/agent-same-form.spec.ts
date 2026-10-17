import { expect, test } from "@playwright/test";

import { knownLossSpec } from "../../acceptance/known-loss";
import { canonicalizeNfm } from "../../shared/nfm";
import { ACTION_HEADERS, AgentClient } from "../helpers";
import { enterGateArm } from "../live-body-gate";

// SF-10: an agent reads and writes the same form the editor stores. Every call
// goes over the MCP transport a connector uses.

test.describe.configure({ retries: 0 });

// Agent-form Markdown: blank lines between paragraphs, an escaped underscore,
// underscore emphasis and a bare dollar sign, all of which the stored form
// writes differently.
const AGENT_FORM = [
  "Alpha paragraph written by an agent.",
  "",
  "Bravo paragraph with __bold__ and snake\\_case.",
  "",
  "Charlie paragraph costs $60.",
].join("\n");

// Text that spans the first paragraph break exists only in the bytes the agent
// sent: the stored form breaks paragraphs with one newline.
const ORIGINAL_ONLY = "agent.\n\nBravo";
const CANONICAL_BOUNDARY = "agent.\nBravo";

interface BodyResult {
  content?: string;
  revision?: string;
  contentFidelity?: { status?: string };
}

function expectStoredForm(
  result: BodyResult | null,
  sent: string,
  label: string,
): void {
  const evidence = `${label}: ${JSON.stringify(result)}`;
  expect(result?.content, evidence).toBe(canonicalizeNfm(sent));
  expect(result?.revision, evidence).toMatch(/^body:\d+:/);
  expect(result?.contentFidelity?.status, evidence).toEqual(expect.any(String));
}

test.describe(
  "SF-10 agents read and write the same form",
  {
    tag: "@SF-10",
  },
  () => {
    let agent: AgentClient;

    test.beforeEach(({ page }) => {
      agent = AgentClient.shared(page);
    });

    // The body create-document reports, read the way a connector reads it. A
    // summary that is not a result object reports no body at all.
    async function createAgentPage(
      title: string,
    ): Promise<{ id: string; created: BodyResult | null }> {
      const { id, result } = await agent.createPage(title, AGENT_FORM);
      if (result.structured) return { id, created: result.structured };
      try {
        return { id, created: JSON.parse(result.text) as BodyResult };
      } catch {
        return { id, created: null };
      }
    }

    test(
      "create, get and edit return the stored body, its revision and a fidelity report",
      knownLossSpec({
        lane: "L3",
        outcome: "SF-10",
        reason:
          "Over MCP, create-document answers with a one-line summary carrying no body, revision or fidelity report, and get-document returns the agent's bytes.",
      }),
      async ({ page }) => {
        const { id, created } = await createAgentPage("SF-10 stored form");
        await enterGateArm(page, id);
        expectStoredForm(created, AGENT_FORM, "create-document");
        const read = await agent.callJson<BodyResult>("get-document", { id });
        expectStoredForm(read, AGENT_FORM, "get-document");
        const edited = await agent.callJson<BodyResult>("edit-document", {
          id,
          baseRevision: read.revision,
          idempotencyKey: `${id}-sf10-edit`,
          edits: [{ find: "Charlie paragraph", replace: "Charlie line" }],
        });
        expectStoredForm(
          edited,
          AGENT_FORM.replace("Charlie paragraph", "Charlie line"),
          "edit-document",
        );
      },
    );

    test("a find taken from the readback applies", async ({ page }) => {
      const { id } = await createAgentPage("SF-10 readback find");
      await enterGateArm(page, id);
      const read = await agent.callJson<BodyResult>("get-document", { id });
      const start = read.content!.indexOf("agent.");
      const end = read.content!.indexOf("Bravo") + "Bravo".length;
      expect(start, JSON.stringify(read)).toBeGreaterThanOrEqual(0);
      const find = read.content!.slice(start, end);
      const receipt = await agent.callJson<{
        applied?: number;
        total?: number;
      }>("edit-document", {
        id,
        baseRevision: read.revision,
        idempotencyKey: `${id}-sf10-readback`,
        edits: [{ find, replace: find.replace("Bravo", "Bravissimo") }],
      });
      expect(receipt.applied, JSON.stringify(receipt)).toBe(1);
      const after = await agent.callJson<BodyResult>("get-document", { id });
      expect(after.content).toContain(find.replace("Bravo", "Bravissimo"));
    });

    test(
      "a find matching only the bytes the agent sent fails, naming the stored text",
      knownLossSpec({
        lane: "L3",
        outcome: "SF-10",
        reason:
          "The page keeps the agent's bytes, so a find written against them still applies instead of failing with the stored excerpt.",
      }),
      async ({ page }) => {
        const { id } = await createAgentPage("SF-10 original bytes find");
        await enterGateArm(page, id);
        const read = await agent.callJson<BodyResult>("get-document", { id });
        const result = await agent.call("edit-document", {
          id,
          baseRevision: read.revision,
          idempotencyKey: `${id}-sf10-original`,
          edits: [{ find: ORIGINAL_ONLY, replace: "agent.\n\nBravissimo" }],
        });
        expect(result.isError, result.raw).toBe(true);
        expect(result.text, result.raw).toContain("EDIT_MATCH_MISSING");
        expect(
          [CANONICAL_BOUNDARY, JSON.stringify(CANONICAL_BOUNDARY).slice(1, -1)]
            .map((excerpt) => result.text.includes(excerpt))
            .some(Boolean),
          `the refusal names the stored text: ${result.raw}`,
        ).toBe(true);
        const after = await agent.callJson<BodyResult>("get-document", { id });
        expect(after.revision, "a refused edit changes nothing").toBe(
          read.revision,
        );
      },
    );

    test("get-document and pull-document return the same body", async ({
      page,
    }) => {
      const { id } = await createAgentPage("SF-10 get and pull");
      await enterGateArm(page, id);
      const read = await agent.callJson<BodyResult>("get-document", { id });
      const response = await page.request.get(
        "/_agent-native/actions/pull-document",
        { params: { id }, headers: ACTION_HEADERS },
      );
      const text = await response.text();
      expect(response.ok(), `pull-document: ${text}`).toBe(true);
      const pulled = JSON.parse(text) as { content?: string };
      expect(pulled.content, text).toBe(read.content);
    });
  },
);
