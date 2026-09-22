import { beforeEach, describe, expect, it } from "vitest";

import {
  defineTransactionalEmail,
  defineTransactionalEmails,
  getTransactionalEmail,
  listTransactionalEmails,
  replaceTransactionalEmails,
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
    expect(() => define("test.dupe", { name: "different" })).toThrow(
      /Duplicate transactional email/,
    );
  });

  it("is idempotent when an equivalent definition re-registers", () => {
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
    expect(() =>
      defineTransactionalEmail({
        ...definition,
        preview: () => ({ ...definition.preview() }),
      }),
    ).not.toThrow();
    expect(listTransactionalEmails()).toHaveLength(1);
  });

  it("does not partially register a batch when a later definition conflicts", () => {
    define("test.conflict", { name: "existing" });
    const first = {
      id: "test.first",
      name: "test.first",
      app: "test-app",
      trigger: "trigger",
      recipient: "recipient",
      recipientLabel: "Recipient",
      sender: "sender",
      senderLabel: "Sender",
      preview: () => ({ subject: "first", html: "", text: "" }),
    };
    const conflict = { ...first, id: "test.conflict", name: "different" };

    expect(() => defineTransactionalEmails([first, conflict])).toThrow(
      /Duplicate transactional email/,
    );

    expect(listTransactionalEmails().map((email) => email.id)).toEqual([
      "test.conflict",
    ]);
  });

  it("replaces only the requested catalog scope", () => {
    define("test-app.stale");
    define("other.keep");
    const current = {
      id: "test-app.current",
      name: "test-app.current",
      app: "test-app",
      trigger: "trigger",
      recipient: "recipient",
      recipientLabel: "Recipient",
      sender: "sender",
      senderLabel: "Sender",
      preview: () => ({ subject: "current", html: "", text: "" }),
    };

    expect(
      replaceTransactionalEmails("test-app", "test-app.", [current]),
    ).toHaveLength(1);
    expect(getTransactionalEmail("test-app.stale")).toBeUndefined();
    expect(getTransactionalEmail("test-app.current")?.name).toBe(
      "test-app.current",
    );
    expect(getTransactionalEmail("other.keep")?.name).toBe("other.keep");
  });

  it("rejects an overlapping replacement scope without mutating the registry", () => {
    define("test-app.stale");
    define("other.keep");

    expect(() => replaceTransactionalEmails("test-app", "test", [])).toThrow(
      /owner app and its exact namespace prefix/,
    );
    expect(getTransactionalEmail("test-app.stale")).toBeDefined();
    expect(getTransactionalEmail("other.keep")).toBeDefined();
  });

  it("allows an owner to refresh metadata within its replacement scope", () => {
    define("test-app.current", { name: "Old name" });
    const updated = {
      id: "test-app.current",
      name: "New name",
      app: "test-app",
      trigger: "updated trigger",
      recipient: "recipient",
      recipientLabel: "Recipient",
      sender: "sender",
      senderLabel: "Sender",
      preview: () => ({ subject: "updated", html: "", text: "" }),
    };

    expect(() =>
      replaceTransactionalEmails("test-app", "test-app.", [updated]),
    ).not.toThrow();
    expect(getTransactionalEmail("test-app.current")?.name).toBe("New name");
  });

  it("rejects a replacement that would modify another app's scope", () => {
    define("test-app.foreign", { app: "other-app" });

    expect(() =>
      replaceTransactionalEmails("test-app", "test-app.", []),
    ).toThrow(/owned by "other-app"/);
    expect(getTransactionalEmail("test-app.foreign")?.app).toBe("other-app");

    expect(() =>
      replaceTransactionalEmails("test-app", "test-app.", [
        {
          id: "test-app.incoming",
          name: "Incoming",
          app: "other-app",
          trigger: "trigger",
          recipient: "recipient",
          recipientLabel: "Recipient",
          sender: "sender",
          senderLabel: "Sender",
          preview: () => ({ subject: "incoming", html: "", text: "" }),
        },
      ]),
    ).toThrow(/only test-app email definitions/);
  });

  it("rejects an unknown runtime from deleting an owner scope", () => {
    define("test-app.stale");

    expect(() =>
      replaceTransactionalEmails("test-app", "test-app.", []),
    ).toThrow(
      /recognized runtime owner or a non-empty snapshot with explicit owner metadata/,
    );
    expect(getTransactionalEmail("test-app.stale")).toBeDefined();
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
