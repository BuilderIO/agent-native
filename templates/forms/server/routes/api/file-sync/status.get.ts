import { defineEventHandler } from "h3";
import { defaultSyncStatusHandler } from "@agent-native/core/server";

export default defineEventHandler(() => defaultSyncStatusHandler());
