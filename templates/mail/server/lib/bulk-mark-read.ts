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
  remainingUnreadMessages: number;
  remainingUnreadThreads: number;
  remainingProtectedMessages: number;
  remainingProtectedThreads: number;
  unexpectedUnreadMessages: number;
  unexpectedUnreadThreads: number;
  verificationComplete: boolean;
}
