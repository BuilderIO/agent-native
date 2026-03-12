import { createProductionServer } from "agentnative/server";
import { createAppServer } from "./index.js";

createProductionServer(createAppServer());
