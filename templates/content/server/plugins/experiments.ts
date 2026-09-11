import { createExperimentsPlugin } from "@agent-native/core/server";

import { CONTENT_EXPERIMENTS } from "../../shared/experiments.js";

export default createExperimentsPlugin({ experiments: CONTENT_EXPERIMENTS });
