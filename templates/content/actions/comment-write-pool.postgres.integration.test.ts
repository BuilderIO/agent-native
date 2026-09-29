import { vi } from "vitest";

vi.mock("../server/lib/comment-notifications.js", () => ({
  notifyDocumentComment: vi.fn(async () => ({ status: "no-recipients" })),
}));
vi.mock("@agent-native/core/application-state", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/application-state")
  >()),
  writeAppState: vi.fn(),
}));
vi.mock("@agent-native/core/tracking", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/tracking")>()),
  track: vi.fn(),
}));
vi.mock("@agent-native/core/collab", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/collab")>()),
  agentTouchDocument: vi.fn(),
}));

import { describe } from "vitest";

import { connectionPoolRegressionSuite } from "./comment-write-pool.test-fixture.js";

const postgresUrl =
  process.env.CONTENT_ROW_MUTATION_POSTGRES_URL ??
  process.env.CONTENT_MIGRATION_POSTGRES_URL;

describe.skipIf(!postgresUrl)(
  "Content writes with a single PostgreSQL connection",
  () => {
    connectionPoolRegressionSuite(postgresUrl);
  },
);
