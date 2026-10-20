import { createLabsPlugin } from "@agent-native/core/server";
import { COMMUNITY_APPS_LAB } from "@agent-native/dispatch/shared/labs";

export default createLabsPlugin({ labs: [COMMUNITY_APPS_LAB] });
