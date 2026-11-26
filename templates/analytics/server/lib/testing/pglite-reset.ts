export async function resetPublicSchema(client: {
  exec(sql: string): Promise<unknown>;
}): Promise<void> {
  await client.exec("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
}
