import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AuthForm } from "./AuthForm.js";

describe("AuthForm", () => {
  it("renders configurable signup markup on the server", () => {
    const html = renderToStaticMarkup(
      <AuthForm
        id="signup-form"
        fields={[
          {
            id: "email",
            label: "Email",
            labelProps: { "data-i18n": "email" },
            inputProps: { type: "email", required: true },
          },
        ]}
        submitLabel="Create account"
        submitProps={{ "data-i18n": "createAccount" }}
        footer={<p>Terms apply.</p>}
        messageId="signup-message"
      />,
    );

    expect(html).toContain('<form id="signup-form" class="form">');
    expect(html).toContain(
      '<label data-i18n="email" for="email">Email</label>',
    );
    expect(html).toContain('<input type="email"');
    expect(html).toContain('required=""');
    expect(html).toContain('id="email"');
    expect(html).toContain(
      '<button data-i18n="createAccount" type="submit">Create account</button>',
    );
    expect(html).toContain("Terms apply.");
    expect(html).toContain('id="signup-message"');
  });
});
