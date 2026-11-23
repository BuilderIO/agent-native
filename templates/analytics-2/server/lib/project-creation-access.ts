import { fail, isActionContractError } from "@agent-native/core/action";

import { notebookCreationMessages } from "../../app/i18n/messages/notebook-creation.js";
import {
  ANALYTICS_CONTROL_IDS,
  requireCurrentWorkspaceCapability,
} from "./analytics-capabilities.js";

const copy = notebookCreationMessages.notebookCreation;

export async function requireProjectCreationAccess() {
  try {
    return await requireCurrentWorkspaceCapability(
      ANALYTICS_CONTROL_IDS.createProject,
    );
  } catch (error) {
    if (isActionContractError(error) && error.statusCode === 403)
      fail(copy.denied, {
        errorCode: "project_create_denied",
        statusCode: 403,
      });
    throw error;
  }
}

export async function checkedProjectCreation<T>(call: () => Promise<T>) {
  try {
    return await call();
  } catch (error) {
    if (isActionContractError(error)) throw error;
    fail(copy.createFailed, {
      errorCode: "project_create_unreadable",
      statusCode: 503,
    });
  }
}
