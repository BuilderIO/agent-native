/**
 * Swappable renderer for every email the framework produces.
 *
 * `renderEmail` is called from inside core — better-auth's verification, magic
 * link, and password-reset senders, org invites, share notifications, review
 * comments — so an app cannot reach those call sites to restyle them. Branding
 * arguments cover the common case; this registry covers the rest, letting an
 * app replace the markup wholesale:
 *
 *   registerEmailRenderer({
 *     id: "acme",
 *     render: (args) => ({ html: acmeTemplate(args), text: acmeText(args) }),
 *   });
 *
 * A renderer that only wants to wrap the framework's output should call
 * `renderBuiltInEmail` rather than `renderEmail`, which would recurse.
 *
 * Deliberately no fallback: if a registered renderer throws, the send fails and
 * `sendEmail` records it to `email_log`. Catching and quietly rendering the
 * built-in template instead would return a value the caller cannot distinguish
 * from success, and ship a password-reset email in the wrong brand while
 * reporting that everything worked.
 */

import type { RenderEmailArgs, RenderedEmail } from "./email-template.js";

export interface EmailRenderer {
  /** Stable id. Registering the same id again replaces the previous entry. */
  id: string;
  /**
   * Produce the message. Must return HTML and a plain-text alternative — the
   * text part is not derived from the HTML anywhere downstream.
   */
  render: (args: RenderEmailArgs) => RenderedEmail;
}

/**
 * Why globalThis: Vite HMR and some Nitro/Rollup bundle splits evaluate this
 * module more than once, landing the registrar and the reader in different
 * module instances. Pinning to the process keeps one registry regardless of
 * how the bundler split the chunks. Mirrors `file-upload/registry.ts`.
 */
const REGISTRY_KEY = Symbol.for("@agent-native/core/email.renderers");

interface GlobalWithRegistry {
  [REGISTRY_KEY]?: Map<string, EmailRenderer>;
}

function getRegistry(): Map<string, EmailRenderer> {
  const globals = globalThis as typeof globalThis & GlobalWithRegistry;
  return (globals[REGISTRY_KEY] ??= new Map());
}

export function registerEmailRenderer(renderer: EmailRenderer): void {
  if (!renderer?.id) {
    throw new Error("registerEmailRenderer: renderer.id is required");
  }
  if (typeof renderer.render !== "function") {
    throw new Error(
      "registerEmailRenderer: renderer.render must be a function",
    );
  }
  getRegistry().set(renderer.id, renderer);
}

export function unregisterEmailRenderer(id: string): void {
  getRegistry().delete(id);
}

export function listEmailRenderers(): EmailRenderer[] {
  return [...getRegistry().values()];
}

/**
 * The renderer `renderEmail` will use, or null for the built-in template.
 *
 * Last registration wins. More than one registered renderer is a
 * misconfiguration rather than a layering feature — two apps in a workspace
 * each claiming the whole email surface produces whichever loaded last, so say
 * so instead of picking silently.
 */
export function getActiveEmailRenderer(): EmailRenderer | null {
  const registry = getRegistry();
  if (registry.size === 0) return null;
  const renderers = [...registry.values()];
  if (renderers.length > 1) {
    console.warn(
      `[agent-native:email] ${renderers.length} email renderers registered ` +
        `(${renderers.map((r) => r.id).join(", ")}). Using "${
          renderers[renderers.length - 1].id
        }". Register exactly one.`,
    );
  }
  return renderers[renderers.length - 1];
}
