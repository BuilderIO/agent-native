export function hasSameDomainCoworker(
  ownerEmail: string,
  memberEmails: string[],
): boolean {
  const owner = ownerEmail.trim().toLowerCase();
  const separator = owner.lastIndexOf("@");
  if (separator <= 0 || separator !== owner.indexOf("@")) return false;

  const domain = owner.slice(separator + 1);
  return memberEmails.some((email) => {
    const member = email.trim().toLowerCase();
    return (
      member !== owner && member.slice(member.lastIndexOf("@") + 1) === domain
    );
  });
}

export async function hasSameDomainCoworkerInPages(
  ownerEmail: string,
  fetchPage: (offset: number) => Promise<{
    members: Array<{ email: string }>;
    hasMore: boolean;
    nextOffset: number | null;
  }>,
): Promise<boolean> {
  let offset = 0;
  while (true) {
    const page = await fetchPage(offset);
    if (
      hasSameDomainCoworker(
        ownerEmail,
        page.members.map((member) => member.email),
      )
    ) {
      return true;
    }
    if (!page.hasMore) return false;
    if (page.nextOffset === null || page.nextOffset <= offset) {
      throw new Error("Organization member search returned an invalid offset");
    }
    offset = page.nextOffset;
  }
}
