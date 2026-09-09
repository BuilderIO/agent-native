import { defineAppRoles } from "@agent-native/core/org";

import { dispatchAccessDescriptor } from "../../shared/app-roles.js";

export const dispatchAccess = defineAppRoles(dispatchAccessDescriptor);
