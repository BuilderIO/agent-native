import { createProductionServer } from "@agent-native/core/server";
import { createAppServer } from "./index.js";
createAppServer().then((app) => createProductionServer(app));
