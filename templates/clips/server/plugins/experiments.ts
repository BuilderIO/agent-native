import { createExperimentsPlugin } from "@agent-native/core/server";

import { CLIPS_EXPERIMENTS } from "../../shared/experiments.js";

export default createExperimentsPlugin({ experiments: CLIPS_EXPERIMENTS });
