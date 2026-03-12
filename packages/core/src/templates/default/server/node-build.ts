import { createProductionServer } from "@agent-native/core";
import { createAppServer } from "./index.js";

createProductionServer(createAppServer());
