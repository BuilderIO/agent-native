import { initDataPrograms } from "@agent-native/core/data-programs";

import { CRM_APP_ID } from "../server/lib/provider-api.js";
import getCrmPipelineData from "./get-crm-pipeline-data.js";

export function getCrmDataProgramActions() {
  return { "get-crm-pipeline-data": getCrmPipelineData };
}

export function initCrmDataPrograms(): void {
  initDataPrograms({
    appId: CRM_APP_ID,
    getActions: getCrmDataProgramActions,
  });
}
