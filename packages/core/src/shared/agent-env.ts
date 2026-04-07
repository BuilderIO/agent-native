/**
 * Isomorphic Agent Env Utility
 *
 * Works in both browser and Node.js contexts:
 * - Browser: sends via postMessage to the parent window
 * - Node.js (scripts): sends via BUILDER_PARENT_MESSAGE stdout format,
 *   which the Electron host translates to postMessage
 */

export interface EnvVar {
  key: string;
  value: string;
}

const AGENT_ENV_MESSAGE_TYPE = "builder.setEnvVars";

const isBrowser =
  typeof window !== "undefined" && typeof window.postMessage === "function";

/**
 * Send env vars to the host (Builder cloud or Claude frame).
 * Automatically detects environment (browser vs Node.js) and uses the right transport.
 */
function setVars(vars: EnvVar[]): void {
  const payload = { type: AGENT_ENV_MESSAGE_TYPE, data: { vars } };

  if (isBrowser) {
    const target = window.parent !== window ? window.parent : window;
    try {
      target.postMessage(payload, "*");
    } catch (err) {
      console.error("[agentEnv] postMessage failed:", err);
    }
  } else {
    // Node.js: use BUILDER_PARENT_MESSAGE stdout format for Electron integration
    console.log(
      "BUILDER_PARENT_MESSAGE:" +
        JSON.stringify({ message: payload, targetOrigin: "*" }),
    );
  }
}

export const agentEnv = {
  /** Send environment variables to the host for persistence */
  setVars,
};
