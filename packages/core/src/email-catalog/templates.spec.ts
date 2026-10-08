import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resetAppConfigForTests } from "../app-config/index.js";
import {
  renderTransactionalEmailPreview,
  renderTransactionalEmailPreviewAsync,
} from "./registry.js";
import { registerCoreSystemEmails } from "./system-emails.js";
import {
  CORE_RESET_PASSWORD_EMAIL_ID,
  CORE_RESOURCE_SHARED_EMAIL_ID,
  CORE_VERIFY_SIGNUP_EMAIL_ID,
  overrideTransactionalEmail,
  removeTransactionalEmailOverride,
  renderTransactionalEmail,
  type CoreTransactionalEmailId,
} from "./templates.js";

const SHARE_ARGS = {
  recipientEmail: "sam@example.com",
  sender: { name: "Alex Chen", email: "alex@example.com" },
  resource: {
    type: "project",
    label: "Project",
    title: "Launch <plan>",
    url: "https://example.com/projects/p1",
  },
  role: "admin" as const,
  app: { name: "Acme Projects", logoUrl: "https://example.com/logo.png" },
};

const OVERRIDDEN: CoreTransactionalEmailId[] = [
  CORE_RESET_PASSWORD_EMAIL_ID,
  CORE_RESOURCE_SHARED_EMAIL_ID,
  CORE_VERIFY_SIGNUP_EMAIL_ID,
];

describe("transactional email overrides", () => {
  beforeEach(() => resetAppConfigForTests());
  afterEach(() => {
    for (const id of OVERRIDDEN) removeTransactionalEmailOverride(id);
  });

  it("renders the framework default when no override is registered", async () => {
    const rendered = await renderTransactionalEmail(
      CORE_RESOURCE_SHARED_EMAIL_ID,
      SHARE_ARGS,
    );
    expect(rendered.subject).toBe('Alex Chen shared with you: "Launch <plan>"');
    expect(rendered.html).toContain("edit and manage access to");
    expect(rendered.html).toContain("Launch &lt;plan&gt;");
  });

  it("passes typed props and the default rendering to an HTML override", async () => {
    let seen: unknown;
    overrideTransactionalEmail(
      CORE_RESOURCE_SHARED_EMAIL_ID,
      (props, defaultEmail) => {
        seen = { props, defaultSubject: defaultEmail.subject };
        return {
          html: `<html><head><title>x</title><style>p{color:red}</style></head><body><p>${props.app.name}: <a href="${props.resource.url}">Open ${props.resource.type}</a></p></body></html>`,
        };
      },
    );

    const rendered = await renderTransactionalEmail(
      CORE_RESOURCE_SHARED_EMAIL_ID,
      SHARE_ARGS,
    );

    expect(seen).toEqual({
      props: SHARE_ARGS,
      defaultSubject: 'Alex Chen shared with you: "Launch <plan>"',
    });
    expect(rendered.subject).toBe('Alex Chen shared with you: "Launch <plan>"');
    expect(rendered.html).toContain("Acme Projects");
    expect(rendered.text).toBe(
      "Acme Projects: Open project (https://example.com/projects/p1)",
    );
  });

  it("renders a React override and resolves the app brand for auth emails", async () => {
    overrideTransactionalEmail(CORE_VERIFY_SIGNUP_EMAIL_ID, (props) => ({
      subject: `Welcome to ${props.app.name}\r\nBcc: attacker@example.com`,
      react: createElement(
        "html",
        null,
        createElement(
          "body",
          null,
          createElement(
            "a",
            { href: props.verifyUrl },
            `Verify ${props.email}`,
          ),
        ),
      ),
      text: `Verify: ${props.verifyUrl}`,
    }));

    const rendered = await renderTransactionalEmail(
      CORE_VERIFY_SIGNUP_EMAIL_ID,
      {
        email: "sam@example.com",
        verifyUrl: "https://example.com/verify?token=a&b=1",
      },
    );

    expect(rendered.subject).toMatch(
      /^Welcome to .+ Bcc: attacker@example\.com$/,
    );
    expect(rendered.subject).not.toMatch(/[\r\n]/);
    expect(rendered.html.startsWith("<!DOCTYPE html><html>")).toBe(true);
    expect(rendered.html).toContain(
      '<a href="https://example.com/verify?token=a&amp;b=1">Verify sam@example.com</a>',
    );
    expect(rendered.text).toBe(
      "Verify: https://example.com/verify?token=a&b=1",
    );
  });

  it("fails the render instead of falling back when an override throws", async () => {
    overrideTransactionalEmail(CORE_RESET_PASSWORD_EMAIL_ID, () => {
      throw new Error("template bug");
    });
    await expect(
      renderTransactionalEmail(CORE_RESET_PASSWORD_EMAIL_ID, {
        email: "sam@example.com",
        resetUrl: "https://example.com/reset",
      }),
    ).rejects.toThrow("template bug");
  });

  it("rejects an override that returns no markup", async () => {
    overrideTransactionalEmail(
      CORE_RESET_PASSWORD_EMAIL_ID,
      () => ({ html: " " }) as { html: string },
    );
    await expect(
      renderTransactionalEmail(CORE_RESET_PASSWORD_EMAIL_ID, {
        email: "sam@example.com",
        resetUrl: "https://example.com/reset",
      }),
    ).rejects.toThrow(/non-empty html or a react element/);
  });

  it("rejects an unknown email id at registration", () => {
    expect(() =>
      overrideTransactionalEmail(
        "core.password-reset" as CoreTransactionalEmailId,
        () => ({ html: "<p>x</p>" }),
      ),
    ).toThrow(/Unknown transactional email "core.password-reset"/);
  });

  it("keeps core previews synchronous until an override is registered", async () => {
    registerCoreSystemEmails();
    expect(
      renderTransactionalEmailPreview(CORE_RESOURCE_SHARED_EMAIL_ID).subject,
    ).toContain("shared with you");

    overrideTransactionalEmail(CORE_RESOURCE_SHARED_EMAIL_ID, () => ({
      html: "<p>Custom share</p>",
    }));
    expect(() =>
      renderTransactionalEmailPreview(CORE_RESOURCE_SHARED_EMAIL_ID),
    ).toThrow(/renderTransactionalEmailPreviewAsync/);
  });

  it("keeps link URLs from every href quoting style in derived text", async () => {
    overrideTransactionalEmail(CORE_RESET_PASSWORD_EMAIL_ID, () => ({
      html: `<p><a href='https://example.com/reset?token=single'>Reset</a> <a href=https://example.com/bare>Bare</a> <a class="b" href="https://example.com/double">Double</a></p>`,
    }));
    const rendered = await renderTransactionalEmail(
      CORE_RESET_PASSWORD_EMAIL_ID,
      { email: "sam@example.com", resetUrl: "https://example.com/reset" },
    );
    expect(rendered.text).toBe(
      "Reset (https://example.com/reset?token=single) Bare (https://example.com/bare) Double (https://example.com/double)",
    );
  });

  it("shows the override in the catalog preview", async () => {
    registerCoreSystemEmails();
    overrideTransactionalEmail(CORE_RESOURCE_SHARED_EMAIL_ID, (props) => ({
      subject: `${props.sender.name} invited you`,
      html: "<p>Custom share</p>",
    }));

    const preview = await renderTransactionalEmailPreviewAsync(
      CORE_RESOURCE_SHARED_EMAIL_ID,
    );

    expect(preview.subject).toBe("Alex Chen invited you");
    expect(preview.html).toBe("<p>Custom share</p>");
  });
});
