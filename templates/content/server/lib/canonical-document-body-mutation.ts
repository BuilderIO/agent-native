export async function commitCanonicalDocumentBodyMutation(input: {
  write: () => Promise<boolean>;
  afterWrite: () => Promise<void>;
}): Promise<boolean> {
  if (!(await input.write())) return false;
  await input.afterWrite();
  return true;
}
