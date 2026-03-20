import { createProductionServer } from "@agent-native/core";
import { createAppServer } from "./index.js";

createAppServer().then((app) => createProductionServer(app));
