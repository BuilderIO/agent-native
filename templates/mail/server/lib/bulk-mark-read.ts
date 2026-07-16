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
  unexpectedUnreadMessages: number | null;
  unexpectedUnreadThreads: number | null;
  verificationComplete: boolean;
  verificationError?: string;
}
