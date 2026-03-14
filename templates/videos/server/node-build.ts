import { createProductionServer } from "@agent-native/core/server";
import { createAppServer } from "./index.js";

createProductionServer(createAppServer());
