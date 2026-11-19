import { describe, expect, it } from "vitest";

import { OPERATION_CATALOG } from "../workflow/catalog/index.js";
import type { WorkflowNode } from "../workflow/contract.js";
import { assertStepWithinCap } from "../workflow/engine/cap.js";
import type { FlowItem } from "../workflow/engine/types.js";
import type { OperationDefinition } from "../workflow/operations.js";
import ticketRouting from "../workflow/stories/06-support-ticket-routing/workflow.json";
import {
  PROVIDER_PAYLOAD_BUDGET_CHARS,
  boundOutput,
  mapItems,
  parseProviderResponse,
} from "./provider-request.js";

function op(id: string): OperationDefinition {
  const def = OPERATION_CATALOG.get(id);
  if (!def) throw new Error(`${id} is not in the catalog`);
  return def;
}

const SCOPE = { orgId: "org-1", factoryId: "factory-1" };

/** One message as Pylon sends it: the HTML body beside the author, recipients and delivery details no reader of the thread needs. */
function message(index: number, paragraphs = 8) {
  return {
    id: `msg_${String(index).padStart(24, "0")}`,
    message_html: `<div>${"<p>The export keeps failing with a blank page after I pick a date range.</p>".repeat(paragraphs)}</div>`,
    source: "email",
    timestamp: "2026-10-28T10:00:00Z",
    is_private: false,
    author_unverified: false,
    author: {
      name: "Pat Customer",
      avatar_url: `https://cdn.example.test/avatars/${"a".repeat(120)}.png`,
      contact: { id: "contact_1", email: "pat@customer.example.test" },
    },
    email_info: {
      from_email: "pat@customer.example.test",
      to_emails: ["support@example.test"],
      cc_emails: [],
      bcc_emails: [],
      message_id: `<${"m".repeat(60)}@mail.customer.example.test>`,
      sender_authentication_status: { dkim: "pass", spf: "pass" },
    },
    reactions: [],
    file_urls: [],
  };
}

const thread = (messages: number, paragraphs?: number) => ({
  data: Array.from({ length: messages }, (_, index) =>
    message(index, paragraphs),
  ),
});

const sizeOf = (value: unknown) => JSON.stringify(value).length;

describe("pylon.ticketThread", () => {
  const def = op("pylon.ticketThread");

  it("declares the budget its answers are cut to", () => {
    expect(def.answerBudgetChars).toBeDefined();
    expect(def.answerBudgetChars).toBeLessThan(PROVIDER_PAYLOAD_BUDGET_CHARS);
  });

  it("cuts a long thread to its budget, keeping the leading messages and saying how many it kept", () => {
    const body = thread(60);
    const parsed = parseProviderResponse(def, body);

    expect(parsed.truncated).toBe(true);
    expect(sizeOf(parsed.output)).toBeLessThanOrEqual(def.answerBudgetChars!);
    const output = parsed.output as {
      truncated: boolean;
      cuts: { path: string; kept?: number; of?: number }[];
      data: unknown[];
    };
    expect(output.truncated).toBe(true);
    expect(output.data.length).toBeGreaterThan(0);
    expect(output.data[0]).toEqual(body.data[0]);
    expect(output.cuts).toContainEqual({
      path: "data",
      kept: output.data.length,
      of: 60,
    });
  });

  it("hands on a thread that fits whole and unmarked", () => {
    const body = thread(2, 2);
    const parsed = parseProviderResponse(def, body);

    expect(parsed.truncated).toBe(false);
    expect(parsed.output).toEqual(body);
  });

  it("cuts at the budget the operation declares, not the provider-wide one", () => {
    const body = thread(6);
    expect(sizeOf(body)).toBeGreaterThan(def.answerBudgetChars!);
    expect(sizeOf(body)).toBeLessThan(PROVIDER_PAYLOAD_BUDGET_CHARS);

    expect(boundOutput(body).truncated).toBe(false);
    expect(parseProviderResponse(def, body).truncated).toBe(true);
  });
});

describe("story 06: support tickets", () => {
  const tickets = ticketRouting.nodes.find((node) => node.id === "tickets");
  const maxItems = (tickets?.settings as { maxItems: number }).maxItems;
  const stepNode = {
    id: "thread",
    name: "thread",
    kind: "lookup",
  } as unknown as WorkflowNode;

  /** The tickets a run takes, as the Source mapped them from Pylon's search answer. */
  function takenTickets(count = maxItems): FlowItem[] {
    const search = {
      data: Array.from({ length: count }, (_, index) => ({
        id: `issue_${String(index).padStart(20, "0")}`,
        title: `Export fails with a blank page for account number ${index}`,
        link: `https://app.usepylon.com/issues/views/all-issues?issueNumber=${100000 + index}&account=${"x".repeat(60)}`,
        created_at: "2026-10-28T10:00:00Z",
        state: "new",
        requester: { email: `person.${index}@customer.example.test` },
      })),
    };
    return mapItems(op("pylon.newTickets"), search, SCOPE).items.map(
      (item): FlowItem => ({
        id: item.id,
        data: { ...item },
        nodes: {},
        inbox: true,
      }),
    );
  }

  const withThread = (items: FlowItem[], output: unknown): FlowItem[] =>
    items.map((item) => ({ ...item, nodes: { thread: output } }));

  /** The largest answer the budget lets through whole: a cut one is always smaller. */
  function atBudget(): unknown {
    const budget = op("pylon.ticketThread").answerBudgetChars!;
    const shell = { data: [{ id: "msg_1", message_html: "" }] };
    const room = budget - sizeOf(shell);
    return {
      data: [{ id: "msg_1", message_html: "x".repeat(room) }],
    };
  }

  const classified = (items: FlowItem[]): FlowItem[] =>
    items.map((item) => ({
      ...item,
      nodes: {
        ...item.nodes,
        classify: {
          category: "billing",
          severity: "medium",
          confidence: "high",
          summary: "s".repeat(600),
        },
      },
    }));

  it("takes only as many tickets as a step can carry when every thread is as long as the budget lets it be, and the model's answer after it", () => {
    const answer = atBudget();
    expect(sizeOf(answer)).toBe(op("pylon.ticketThread").answerBudgetChars);
    expect(
      parseProviderResponse(op("pylon.ticketThread"), answer).output,
    ).toEqual(answer);
    const items = withThread(takenTickets(), answer);

    expect(items).toHaveLength(maxItems);
    expect(() => assertStepWithinCap(stepNode, items)).not.toThrow();
    expect(() =>
      assertStepWithinCap(stepNode, classified(items)),
    ).not.toThrow();
  });

  it("carries a long thread that was cut", () => {
    const cut = parseProviderResponse(
      op("pylon.ticketThread"),
      thread(100, 20),
    );
    expect(cut.truncated).toBe(true);
    const items = withThread(takenTickets(), cut.output);

    expect(() =>
      assertStepWithinCap(stepNode, classified(items)),
    ).not.toThrow();
  });

  it("would not fit if the threads were cut only at the provider-wide budget", () => {
    const uncut = boundOutput(thread(100, 20), PROVIDER_PAYLOAD_BUDGET_CHARS);
    const items = withThread(takenTickets(), uncut.output);

    expect(() => assertStepWithinCap(stepNode, items)).toThrow(
      expect.objectContaining({ code: "output_over_cap" }),
    );
  });

  it("would not fit at the 50 tickets the story took before", () => {
    const items = withThread(takenTickets(50), atBudget());

    expect(items).toHaveLength(50);
    expect(() => assertStepWithinCap(stepNode, items)).toThrow(
      expect.objectContaining({ code: "output_over_cap" }),
    );
  });
});
