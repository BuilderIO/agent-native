import type { McpCallerContext, VerifyAuthResult } from "./index.js";

type Assert<T extends true> = T;

type Success = Extract<VerifyAuthResult, { authed: true }>;
type Failure = Extract<VerifyAuthResult, { authed: false }>;

export type SuccessRequiresContext = Assert<
  Success["callerContext"] extends McpCallerContext ? true : false
>;
export type FailureHasNoContext = Assert<
  Failure["callerContext"] extends undefined ? true : false
>;
export type FailureHasNoIdentity = Assert<
  Failure["identity"] extends undefined ? true : false
>;
export type SuccessHasNoRefusal = Assert<
  Success["refusal"] extends undefined ? true : false
>;
export type MissingContextIsRejected = Assert<
  { authed: true } extends VerifyAuthResult ? false : true
>;
export type ConflictingFailureIsRejected = Assert<
  {
    authed: false;
    unavailable: true;
    refusal: "invalid";
  } extends VerifyAuthResult
    ? false
    : true
>;
