import { FILTER_PARAM_PREFIX } from "../app/pages/adhoc/sql-dashboard/filter-vars";
import { UNUSED_OUTPUT_PARAM } from "./output-use";
import {
  SESSION_DID_EVENT_PARAM,
  SESSION_DID_NOT_EVENT_PARAM,
} from "./session-events";
import { SESSION_FRICTION_SIGNAL_PARAM } from "./session-friction";

/** The Sessions page filters `view-screen` reads from the URL. */
export const SESSION_FILTER_KEYS = [
  "range",
  "app",
  "q",
  "fromDate",
  "toDate",
  "from",
  "to",
  "sort",
  "page",
  "triage",
  "includeZeroMinuteSessions",
  "minDurationMs",
  "hideEmpty",
  "hideInternal",
  "visitorType",
  "emailDomain",
  "environment",
  "hasErrors",
  "hasNetworkErrors",
  "hasRageClicks",
] as const;

/**
 * Every query key `view-screen` reads from `__url__`: the Sessions filters, the
 * event, friction, slow and unused filters, and a dashboard's `f_` filters. The
 * agent sees any other key's name but not its value.
 */
export const AGENT_URL_QUERY_KEYS = [
  ...SESSION_FILTER_KEYS,
  SESSION_DID_EVENT_PARAM,
  SESSION_DID_NOT_EVENT_PARAM,
  SESSION_FRICTION_SIGNAL_PARAM,
  UNUSED_OUTPUT_PARAM,
  "slow",
  `${FILTER_PARAM_PREFIX}*`,
] as const;
