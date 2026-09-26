export interface EnvVar {
  key: string;
  value: string;
}

const AGENT_ENV_MESSAGE_TYPE = "agentNative.setEnvVars";

const isBrowser =
  typeof window !== "undefined" && typeof window.postMessage === "function";

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
    console.log(
      "BUILDER_PARENT_MESSAGE:" +
        JSON.stringify({ message: payload, targetOrigin: "*" }),
    );
  }
}

export const agentEnv = {
  setVars,
};
