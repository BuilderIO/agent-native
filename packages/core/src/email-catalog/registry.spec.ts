import { beforeEach, describe, expect, it } from "vitest";

import {
  defineTransactionalEmail,
  getTransactionalEmail,
  listTransactionalEmails,
  renderTransactionalEmailPreview,
  resetTransactionalEmailRegistry,
} from "./registry.js";

function define(id: string, overrides: Record<string, unknown> = {}) {
  return defineTransactionalEmail({
    id,
    name: id,
    app: "test-app",
    trigger: "trigger",
    recipient: "recipient",
    recipientLabel: "Recipient",
    sender: "sender",
    senderLabel: "Sender",
    preview: () => ({
      subject: `subject:${id}`,
      html: "<p>hi</p>",
      text: "hi",
    }),
    ...overrides,
  });
}

describe("transactional email registry", () => {
  beforeEach(() => resetTransactionalEmailRegistry());

  it("registers and returns a definition", () => {
    define("test.one");
    expect(getTransactionalEmail("test.one")?.name).toBe("test.one");
  });

  it("sorts by app then name", () => {
    define("b.one", { app: "b", name: "zebra" });
    define("a.one", { app: "a", name: "apple" });
    define("b.two", { app: "b", name: "alpha" });
    expect(listTransactionalEmails().map((e) => e.id)).toEqual([
      "a.one",
      "b.two",
      "b.one",
    ]);
  });

  it("throws on a duplicate id rather than silently merging", () => {
    define("test.dupe");
    expect(() => define("test.dupe")).toThrow(/Duplicate transactional email/);
  });

  it("is idempotent when the same definition object re-registers", () => {
    const definition = {
      id: "test.same",
      name: "same",
      app: "test-app",
      trigger: "t",
      recipient: "r",
      recipientLabel: "R",
      sender: "s",
      senderLabel: "S",
      preview: () => ({ subject: "s", html: "h", text: "t" }),
    };
    defineTransactionalEmail(definition);
    expect(() => defineTransactionalEmail(definition)).not.toThrow();
    expect(listTransactionalEmails()).toHaveLength(1);
  });

  it("renders a preview by id", () => {
    define("test.preview");
    expect(renderTransactionalEmailPreview("test.preview").subject).toBe(
      "subject:test.preview",
    );
  });

  it("throws for an unknown preview id instead of returning an empty body", () => {
    expect(() => renderTransactionalEmailPreview("test.missing")).toThrow(
      /Unknown transactional email/,
    );
  });
});
