import { createExperimentsPlugin } from "@agent-native/core/server";

import { DESIGN_EXPERIMENTS } from "../../shared/experiments.js";

export default createExperimentsPlugin({ experiments: DESIGN_EXPERIMENTS });
