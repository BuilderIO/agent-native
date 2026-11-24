// Strong mail words win over everything, a GitHub issue or pull request noun
// wins over a bare "message" (commit messages, PR messages), and a bare
// "message" is the weakest mail signal.
const MAIL_STRONG = /\b(?:e-?mails?|inbox)\b/i;
const MAIL_WEAK = /\bmessages?\b/i;
const GITHUB = /\bgithub\b/i;
const GITHUB_RECORD = /\b(?:issues?|pull requests?|prs?)\b/i;

export type DataIntentApp = "mail" | "tasks";

export function classifyDataIntent(text: string): DataIntentApp | null {
  if (MAIL_STRONG.test(text)) return "mail";
  if (GITHUB.test(text) && GITHUB_RECORD.test(text)) return "tasks";
  if (MAIL_WEAK.test(text)) return "mail";
  return null;
}
