/**
 * Client-side entry for @{{APP_NAME}}/core-module.
 *
 * This is where shared React components, hooks, and providers that EVERY
 * app in your workspace needs live. Think of it as the "app shell" layer
 * between the framework's primitives (@agent-native/core/client) and the
 * individual app's screens:
 *
 *   - Authenticated layouts (header / sidebar / footer with brand)
 *   - Org switchers wired to your company's org plugin
 *   - Common chrome: loading states, error boundaries, empty states
 *   - Wrappers around @agent-native/core components that apply your
 *     enterprise design tokens
 *
 * Apps import from here instead of re-implementing or copy-pasting:
 *
 *   import { AuthenticatedLayout } from "@{{APP_NAME}}/core-module/client";
 *
 * NOTE: This package does not ship shadcn/ui or a generic design system
 * by default. If you already have an internal `@{{APP_NAME}}/design-system`
 * package, add it as a dep here and re-export from this file. Otherwise
 * you can drop any shadcn components the apps share into `./ui/` and
 * export them from this index.
 */

export { AuthenticatedLayout } from "./AuthenticatedLayout.js";
