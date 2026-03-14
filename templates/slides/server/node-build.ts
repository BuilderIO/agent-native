import { createProductionServer } from "@agent-native/core";
import { createAppServer } from "./index.js";

const app = createAppServer();
createProductionServer(app);
