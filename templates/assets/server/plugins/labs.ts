import { createLabsPlugin } from "@agent-native/core/server";
import { CREATIVE_CONTEXT_LIBRARY_LAB } from "@agent-native/creative-context";

export default createLabsPlugin({ labs: [CREATIVE_CONTEXT_LIBRARY_LAB] });
