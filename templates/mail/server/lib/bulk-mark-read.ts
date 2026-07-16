export interface BulkMarkReadFailure {
  id: string;
  error: string;
}

export interface BulkMarkReadResult {
  mode: "all-unread";
  accountEmail: string;
  matchedMessages: number;
  matchedThreads: number;
  excludedMessages: number;
  excludedThreads: number;
  changedMessages: number;
  batchCount: number;
  failures: BulkMarkReadFailure[];
  remainingUnreadMessages: number | null;
  remainingUnreadThreads: number | null;
  remainingProtectedMessages: number | null;
  remainingProtectedThreads: number | null;
  /** Initially selected messages that were still unread during verification. */
  unexpectedUnreadMessages: number | null;
  /** Threads containing initially selected messages still unread at verification. */
  unexpectedUnreadThreads: number | null;
  /** Messages not present in the initial unread snapshot. */
  newUnreadMessages?: number | null;
  /** Threads containing messages not present in the initial unread snapshot. */
  newUnreadThreads?: number | null;
  verificationComplete: boolean;
  verificationError?: string;
}
