/**
 * Server-side entry for @{{APP_NAME}}/shared.
 *
 * Exports plugin overrides for any framework slot you want to customize
 * across every app in this workspace. The agent-native framework looks for
 * these exports by name when deciding what to auto-mount — see the "three
 * layer inheritance" section in the root README.
 *
 * Supported export names (any subset):
 *   - authPlugin            → overrides @agent-native/core's auth
 *   - orgPlugin             → overrides @agent-native/core's org
 *   - agentChatPlugin       → overrides @agent-native/core's agent-chat
 *   - coreRoutesPlugin      → overrides @agent-native/core's core-routes
 *   - integrationsPlugin    → overrides @agent-native/core's integrations
 *   - resourcesPlugin       → overrides @agent-native/core's resources
 *   - terminalPlugin        → overrides @agent-native/core's terminal
 *
 * Anything you don't export falls through to the framework default.
 */

export { authPlugin } from "./auth-plugin.js";
export { agentChatPlugin } from "./agent-chat-plugin.js";
