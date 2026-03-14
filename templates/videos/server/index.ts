import "dotenv/config";
import { createServer } from "@agent-native/core/server";
import { handleDemo } from "./routes/demo";
import { handleSaveCompositionDefaults } from "./routes/save-composition";

export function createAppServer() {
  const app = createServer();

  app.get("/api/demo", handleDemo);

  // Save composition defaults to registry
  app.post("/api/save-composition-defaults", handleSaveCompositionDefaults);

  return app;
}
