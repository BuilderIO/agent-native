import { fileURLToPath } from "node:url";

import { registerFileUploadProvider } from "@agent-native/core/file-upload";
import { z } from "zod";

import { phase1AskFixtureKey } from "../../../server/lib/phase1-ask-fixture.js";
import { phase1DraftFixtureKey } from "../../../shared/phase1-draft-fixture.js";
import { phase1ScheduleFixtureKey } from "../../../shared/phase1-schedule-fixture.js";
import { phase1WarehouseFixtureKey } from "../../../shared/phase1-warehouse-fixture.js";
import { askControlInput, createAskControl } from "./ask-control.js";
import { startControlServer } from "./control-server.js";
import {
  createWarehouseFaultControl,
  warehouseFaultInput,
} from "./provider-fault.js";
import { createPhase1UploadStorage } from "./upload-storage.js";
import { createWorkerControl, workerInput } from "./worker-control.js";

if (process.env.AGENT_NATIVE_DEPLOYMENT_ENVIRONMENT !== "local")
  throw new Error(
    "Start the Phase 1 worker with AGENT_NATIVE_DEPLOYMENT_ENVIRONMENT=local NITRO_HOST=127.0.0.1 AGENT_NATIVE_DISABLE_INPROCESS_SWEEPS=1",
  );

const { bridge, draftBridge, control } = createWorkerControl();
const warehouse = createWarehouseFaultControl();
const ask = createAskControl();
Object.defineProperty(globalThis, phase1AskFixtureKey, { value: ask.bridge });
Object.defineProperty(globalThis, phase1ScheduleFixtureKey, { value: bridge });
Object.defineProperty(globalThis, phase1DraftFixtureKey, {
  value: draftBridge,
});
Object.defineProperty(globalThis, phase1WarehouseFixtureKey, {
  value: warehouse.bridge,
});
const port = 4412;
const uploads = createPhase1UploadStorage(port);
const server = await startControlServer(
  port,
  "/phase1/worker-control",
  z.discriminatedUnion("operation", [
    warehouseFaultInput,
    workerInput,
    askControlInput,
  ]),
  async (input) => {
    if ("connectionId" in input) return warehouse.control(input);
    if (
      input.operation === "ask-model-unavailable" ||
      input.operation === "ask-fail-upload"
    )
      return ask.control(input);
    return control(input);
  },
  (req, res) => {
    if (
      req.method !== "GET" ||
      req.headers.origin ||
      req.headers.host !== `127.0.0.1:${port}` ||
      !req.url
    )
      return false;
    const file = uploads.read(req.url);
    if (!file) return false;
    res.writeHead(200, {
      "cache-control": "no-store",
      "content-type": "application/octet-stream",
    });
    res.end(file);
    return true;
  },
);
registerFileUploadProvider(uploads.provider);
try {
  process.chdir(fileURLToPath(new URL("../../../", import.meta.url)));
  await import(
    new URL("../../../.output/server/index.mjs", import.meta.url).href
  );
  console.log(`Phase 1 worker fixture at http://127.0.0.1:${port}`);
} catch (error) {
  server.close();
  throw error;
}
