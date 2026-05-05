import { registerRequiredSecret } from "@agent-native/core/secrets";

// Optional: enables design-system import from private GitHub repositories.
// The import-github action reads this server-side via resolveSecret(); tokens
// should never be pasted into chat or passed as action parameters.
registerRequiredSecret({
  key: "GITHUB_TOKEN",
  label: "GitHub token",
  description:
    "Optional. Enables design-token import from private GitHub repositories. Use a fine-grained token limited to the target repository with Contents read access.",
  docsUrl:
    "https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens",
  scope: "user",
  kind: "api-key",
  required: false,
  validator: async (value) => {
    if (!value) return true;
    try {
      const res = await fetch("https://api.github.com/user", {
        headers: {
          Accept: "application/vnd.github.v3+json",
          Authorization: `Bearer ${value}`,
          "User-Agent": "AgentNative/1.0",
        },
      });
      if (res.ok) return true;
      if (res.status === 401) {
        return { ok: false, error: "GitHub rejected this token (401)." };
      }
      if (res.status === 403) {
        return {
          ok: false,
          error:
            "GitHub rejected this token (403). Check SSO or organization approval.",
        };
      }
      return { ok: false, error: `GitHub returned ${res.status}.` };
    } catch (err: any) {
      return {
        ok: false,
        error: `Could not reach GitHub: ${err?.message ?? err}`,
      };
    }
  },
});
