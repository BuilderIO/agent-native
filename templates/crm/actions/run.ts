import { initDataPrograms } from "@agent-native/core/data-programs";
import { runScript } from "@agent-native/core/scripts";

import getCrmPipelineData from "./get-crm-pipeline-data.js";

initDataPrograms({
  appId: "crm",
  getActions: () => ({ "get-crm-pipeline-data": getCrmPipelineData }),
});

runScript();
