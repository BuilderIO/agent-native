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
    } catch {
      return {
        ok: false,
        error: "Could not reach GitHub. Check your network and try again.",
      };
    }
  },
});

// Optional: connects Figma frame import, library browsing, and open-ended REST
// reads in agent chat. The provider API injects this server-side as
// X-Figma-Token; never pass it through action parameters or chat.
registerRequiredSecret({
  key: "FIGMA_ACCESS_TOKEN",
  label: "Figma access token",
  description:
    "Connect Figma frame links, exact clipboard paste, libraries, styles, and open-ended agent queries. Generate a personal access token with current_user:read and file_content:read; add library_content:read for file libraries, team_library_content:read for team libraries, or Enterprise file_variables:read only when needed.",
  docsUrl: "https://developers.figma.com/docs/rest-api/personal-access-tokens/",
  scope: "user",
  kind: "api-key",
  required: false,
  validator: async (value) => {
    if (!value) return true;
    try {
      const res = await fetch("https://api.figma.com/v1/me", {
        headers: {
          "X-Figma-Token": value,
          "User-Agent": "AgentNative/1.0",
        },
      });
      if (res.ok) return true;
      if (res.status === 401 || res.status === 403) {
        return {
          ok: false,
          error: `Figma rejected this token (${res.status}). Check that it is active and includes current_user:read; frame import also needs file_content:read.`,
        };
      }
      return { ok: false, error: `Figma returned ${res.status}.` };
    } catch {
      return {
        ok: false,
        error: "Could not reach Figma. Check your network and try again.",
      };
    }
  },
});
