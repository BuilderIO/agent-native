import { defineAppRoles } from "@agent-native/core";

import { dispatchAccessDescriptor } from "../../shared/app-roles.js";

export const dispatchAccess = defineAppRoles(dispatchAccessDescriptor);
