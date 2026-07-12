/**
 * Free / public mailbox providers that should NOT be allowed as an
 * organization's auto-join domain.
 *
 * Why: the auto-join feature lets anyone who signs up with an email at the
 * org's `allowed_domain` join the org without an invitation. That is safe
 * for company-owned domains (`acme.com`) — the company controls who gets
 * an `@acme.com` address. It is catastrophic for shared mailbox providers
 * (`gmail.com`, `outlook.com`, etc.) — anyone in the world can create a
 * matching address and would be auto-added to the org.
 *
 * The list intentionally errs on the side of well-known providers; if a
 * future provider isn't here we'll learn from a bug report rather than
 * pretend we have an exhaustive registry.
 */
export const FREE_EMAIL_PROVIDER_DOMAINS: ReadonlySet<string> = new Set([
  // Google
  "gmail.com",
  "googlemail.com",
  // Microsoft
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "outlook.co.uk",
  "hotmail.co.uk",
  "live.co.uk",
  "outlook.de",
  "hotmail.de",
  "live.de",
  "outlook.fr",
  "hotmail.fr",
  "live.fr",
  // Yahoo
  "yahoo.com",
  "yahoo.co.uk",
  "yahoo.co.jp",
  "yahoo.fr",
  "yahoo.de",
  "yahoo.it",
  "yahoo.es",
  "yahoo.ca",
  "yahoo.com.au",
  "yahoo.com.br",
  "ymail.com",
  "rocketmail.com",
  // Apple
  "icloud.com",
  "me.com",
  "mac.com",
  // AOL / Verizon
  "aol.com",
  "aim.com",
  // Privacy / disposable / forwarding
  "proton.me",
  "protonmail.com",
  "pm.me",
  "tutanota.com",
  "tutanota.de",
  "tuta.io",
  "fastmail.com",
  "fastmail.fm",
  "duck.com",
  "hey.com",
  // Russian / Chinese majors
  "yandex.com",
  "yandex.ru",
  "mail.ru",
  "list.ru",
  "bk.ru",
  "inbox.ru",
  "qq.com",
  "163.com",
  "126.com",
  "sina.com",
  "sina.cn",
  "sohu.com",
  // ISP / legacy / misc
  "gmx.com",
  "gmx.de",
  "gmx.net",
  "web.de",
  "t-online.de",
  "freenet.de",
  "zoho.com",
  "zohomail.com",
  "rediffmail.com",
  "mail.com",
  "att.net",
  "comcast.net",
  "verizon.net",
  "sbcglobal.net",
  "bellsouth.net",
  "cox.net",
  "earthlink.net",
  "btinternet.com",
  "btopenworld.com",
  "talktalk.net",
  "sky.com",
  "ntlworld.com",
  "virginmedia.com",
  "free.fr",
  "orange.fr",
  "wanadoo.fr",
  "laposte.net",
  "libero.it",
  "tiscali.it",
  "uol.com.br",
  "bol.com.br",
  "terra.com.br",
  // Disposable
  "mailinator.com",
  "guerrillamail.com",
  "10minutemail.com",
  "trashmail.com",
  "yopmail.com",
  "tempmail.com",
  "throwawaymail.com",
  "sharklasers.com",
]);

export function isFreeEmailProvider(domain: string): boolean {
  return FREE_EMAIL_PROVIDER_DOMAINS.has(domain.trim().toLowerCase());
}
