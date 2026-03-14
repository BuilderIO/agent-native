// Stub auth module — no authentication required.
// getIdToken returns null so existing fetch calls safely skip the Authorization header.

export interface BuilderAuth {
  email: string;
}

export async function getIdToken(): Promise<string | null> {
  return null;
}

export async function signOutUser(): Promise<void> {
  // no-op
}
