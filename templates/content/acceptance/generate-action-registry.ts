import path from "node:path";

import { generateActionRegistryForProject } from "@agent-native/core/vite";

// Tests that drive the MCP server import `.generated/actions-registry.js`,
// which only a build or dev server writes. CI runs Content's tests before any
// build, so without this those tests fail on a missing module.
export default function setup(): void {
  generateActionRegistryForProject(path.resolve(import.meta.dirname, ".."));
}
