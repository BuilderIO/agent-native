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
