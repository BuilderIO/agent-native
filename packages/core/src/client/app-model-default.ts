/**
 * The current app's default agent model (browser).
 *
 * Named client helper for `/_agent-native/agent-model-defaults`, the setting
 * behind `agent-app-model-default:<appId>`. The agent changes the same value
 * with `manage-agent-engine` (`get-app-default`, `set-app-default`,
 * `reset-app-default`); UI code calls these instead of hand-writing a fetch.
 */

import { agentNativePath } from "./api-path.js";

export interface AppModelDefaultEngine {
  name: string;
  label: string;
  defaultModel: string;
  /** The models the picker offers, after the provider's model selection. */
  supportedModels: string[];
  packageInstalled?: boolean;
  configured: boolean;
}

export interface AppModelDefaultSelection {
  engine: string;
  model: string;
}

export interface AppModelDefaultState {
  appId: string;
  /** The app's own default; both `null` when it uses the organization's. */
  engine: string | null;
  model: string | null;
  source: "org" | "user" | "default";
  /** Owners and admins, or a signed-in user with no organization. */
  canUpdate: boolean;
  orgName?: string | null;
  /**
   * The organization's default model, which applies while the app sets none.
   * `null` when nobody chose one; absent from servers that don't report it.
   */
  orgDefault?: { engine: string; model: string | null } | null;
  engines: AppModelDefaultEngine[];
}

const ROUTE = "/_agent-native/agent-model-defaults";
const CONFIGURED_CHANGED_EVENT = "agent-engine:configured-changed";

async function readState(response: Response): Promise<AppModelDefaultState> {
  let body: (AppModelDefaultState & { error?: string }) | null;
  try {
    body = await response.json();
  } catch (cause) {
    throw new Error(
      `App default model response wasn't JSON (${response.status})`,
      { cause },
    );
  }
  if (!response.ok || !body || !Array.isArray(body.engines)) {
    throw new Error(
      body?.error ?? `App default model request failed (${response.status})`,
    );
  }
  return body;
}

function announceChange() {
  if (typeof window === "undefined") return;
  // The composer and model pickers re-read the engine when this fires.
  window.dispatchEvent(new CustomEvent(CONFIGURED_CHANGED_EVENT));
}

export async function fetchAppModelDefault(): Promise<AppModelDefaultState> {
  return readState(await fetch(agentNativePath(ROUTE)));
}

/** Owners and admins only; the server answers 403 for everyone else. */
export async function saveAppModelDefault(
  selection: AppModelDefaultSelection,
): Promise<AppModelDefaultState> {
  const state = await readState(
    await fetch(agentNativePath(ROUTE), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(selection),
    }),
  );
  announceChange();
  return state;
}

/** Clear the app's own default so it uses the organization's again. */
export async function resetAppModelDefault(): Promise<AppModelDefaultState> {
  const state = await readState(
    await fetch(agentNativePath(ROUTE), { method: "DELETE" }),
  );
  announceChange();
  return state;
}
