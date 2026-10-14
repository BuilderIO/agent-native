import { useT } from "@agent-native/core/client/i18n";
import { marked, type Token, type Tokens } from "marked";
import { Fragment, type ReactNode } from "react";
import { Link } from "react-router";

import { TemplateLandingFaq } from "../template-landing";
import { CodeBlock } from "../website-redesign/ds/code-block";
import { safeHref, type Article } from "./public-content";
import { CampaignCta, CampaignScreenshot, CopyControl } from "./shared";

export function sanitizedMarkdown(body: string): string {
  const source = body.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "");
  const tokens = marked.lexer(source);
  return tokens
    .map((token) => {
      if (
        token.type === "html" &&
        !/^<!-- (screenshot|try-it) -->\s*$/.test(token.raw)
      )
        return "";
      return token.raw;
    })
    .join("");
}

export function headingId(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s+/g, "-");
}

function decodeText(value: string): string {
  const entities: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: "\u00a0",
    ndash: "–",
    mdash: "—",
    hellip: "…",
    copy: "©",
    reg: "®",
  };
  return value.replace(
    /&(#x[\da-f]+|#\d+|[a-z]+);/gi,
    (entity, name: string) => {
      if (!name.startsWith("#")) return entities[name] ?? entity;
      const point = /^#x/i.test(name)
        ? Number.parseInt(name.slice(2), 16)
        : Number.parseInt(name.slice(1), 10);
      return point > 0 &&
        point <= 0x10ffff &&
        !(point >= 0xd800 && point <= 0xdfff)
        ? String.fromCodePoint(point)
        : "\ufffd";
    },
  );
}

function requiredTokens(tokens: Token[] | undefined): Token[] {
  if (!tokens) throw new Error("Expected marked inline tokens");
  return tokens;
}

function inlineText(tokens: Token[] | undefined): string {
  return requiredTokens(tokens)
    .map((token) => {
      if ("tokens" in token && token.tokens) return inlineText(token.tokens);
      if (token.type === "br") return "\n";
      if (token.type === "html") return "";
      if ("text" in token)
        return token.type === "codespan" ? token.text : decodeText(token.text);
      return "";
    })
    .join("");
}

function inline(tokens: Token[] | undefined): ReactNode {
  return requiredTokens(tokens).map((token, i) => {
    let node: ReactNode;
    switch (token.type) {
      case "strong":
        node = <strong>{inline(token.tokens)}</strong>;
        break;
      case "em":
        node = <em>{inline(token.tokens)}</em>;
        break;
      case "del":
        node = <del>{inline(token.tokens)}</del>;
        break;
      case "codespan":
        node = <code>{token.text}</code>;
        break;
      case "br":
        node = <br />;
        break;
      case "link": {
        const href = safeHref(decodeText(token.href));
        const label = inline(token.tokens);
        node = !href ? (
          label
        ) : href.startsWith("/") && !href.startsWith("//") ? (
          <Link to={href}>{label}</Link>
        ) : (
          <a href={href}>{label}</a>
        );
        break;
      }
      case "image": {
        const src = safeHref(decodeText(token.href));
        node = src ? (
          <img
            src={src}
            alt={token.text}
            title={token.title ?? undefined}
            loading="lazy"
            className="max-w-full"
          />
        ) : (
          token.text
        );
        break;
      }
      case "html":
        node = null;
        break;
      default:
        node =
          "tokens" in token && token.tokens
            ? inline(token.tokens)
            : "text" in token
              ? decodeText(token.text)
              : null;
    }
    return <Fragment key={i}>{node}</Fragment>;
  });
}

export interface ArticleFaq {
  q: string;
  a: string;
  answer: Token[];
  id: string;
}

export function parseArticle(body: string) {
  const tokens = marked.lexer(sanitizedMarkdown(body));
  const start = tokens.findIndex(
    (token) =>
      token.type === "heading" &&
      token.depth === 2 &&
      inlineText(token.tokens).trim().toLowerCase() ===
        "frequently asked questions",
  );
  if (start < 0)
    return {
      before: tokens,
      after: [] as Token[],
      faqs: [] as ArticleFaq[],
      faqTitle: "",
    };
  let end = start + 1;
  while (
    end < tokens.length &&
    !(
      tokens[end].type === "heading" &&
      (tokens[end] as Tokens.Heading).depth <= 2
    )
  )
    end++;
  const faqs: ArticleFaq[] = [];
  let hasIntro = false;
  for (const token of tokens.slice(start + 1, end)) {
    if (token.type === "heading" && token.depth === 3) {
      const q = inlineText(token.tokens);
      faqs.push({ q, a: "", answer: [], id: headingId(q) });
    } else if (faqs.length && token.type !== "space") {
      const faq = faqs[faqs.length - 1];
      faq.answer.push(token);
      const text =
        "tokens" in token && token.tokens
          ? inlineText(token.tokens)
          : "text" in token
            ? token.text
            : "";
      faq.a += (faq.a ? "\n\n" : "") + text;
    } else if (token.type !== "space") {
      hasIntro = true;
    }
  }
  if (hasIntro || !faqs.length)
    return { before: tokens, after: [] as Token[], faqs, faqTitle: "" };
  return {
    before: tokens.slice(0, start),
    after: tokens.slice(end),
    faqs,
    faqTitle: inlineText((tokens[start] as Tokens.Heading).tokens),
  };
}

export function MarkdownBlocks({
  tokens,
  article,
  headingIds = new Map<string, number>(),
}: {
  tokens: Token[];
  article: Article;
  headingIds?: Map<string, number>;
}) {
  return (
    <>
      {tokens.map((token, i) => {
        let node: ReactNode;
        switch (token.type) {
          case "heading": {
            const base = headingId(inlineText(token.tokens));
            const count = headingIds.get(base) ?? 0;
            headingIds.set(base, count + 1);
            const id = count ? `${base}-${count + 1}` : base;
            const Heading = `h${Math.max(2, token.depth)}` as
              | "h2"
              | "h3"
              | "h4"
              | "h5"
              | "h6";
            node = (
              <Heading
                id={id}
                className="group scroll-mt-24 flex items-start gap-2"
              >
                {inline(token.tokens)}
                <CopyControl text={id} heading />
              </Heading>
            );
            break;
          }
          case "paragraph":
            node = <p>{inline(token.tokens)}</p>;
            break;
          case "text":
            node = <>{token.tokens ? inline(token.tokens) : token.text}</>;
            break;
          case "code":
            node = (
              <CodeBlock
                code={token.text}
                language={token.lang?.split(/\s/)[0] || "text"}
              />
            );
            break;
          case "blockquote":
            node = (
              <blockquote>
                <MarkdownBlocks
                  tokens={requiredTokens(token.tokens)}
                  article={article}
                  headingIds={headingIds}
                />
              </blockquote>
            );
            break;
          case "list": {
            const List = token.ordered ? "ol" : "ul";
            node = (
              <List start={token.ordered ? token.start : undefined}>
                {(token as Tokens.List).items.map((item, n) => (
                  <li key={n}>
                    <MarkdownBlocks
                      tokens={item.tokens}
                      article={article}
                      headingIds={headingIds}
                    />
                  </li>
                ))}
              </List>
            );
            break;
          }
          case "table":
            node = (
              <div className="max-w-full overflow-x-auto">
                <table>
                  <thead>
                    <tr>
                      {(token as Tokens.Table).header.map((cell, n) => (
                        <th key={n}>{inline(cell.tokens)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(token as Tokens.Table).rows.map((row, n) => (
                      <tr key={n}>
                        {row.map((cell, c) => (
                          <td key={c}>{inline(cell.tokens)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
            break;
          case "hr":
            node = <hr />;
            break;
          case "html":
            node =
              token.raw.trim() === "<!-- screenshot -->" ? (
                <CampaignScreenshot item={article} />
              ) : token.raw.trim() === "<!-- try-it -->" ? (
                <div className="not-prose my-8">
                  <CampaignCta item={article} location="inline" />
                </div>
              ) : null;
            break;
          default:
            node = null;
        }
        return <Fragment key={i}>{node}</Fragment>;
      })}
    </>
  );
}

export function ArticleBody({ article }: { article: Article }) {
  const t = useT();
  const parsed = parseArticle(article.body);
  const ids = new Map<string, number>();
  return (
    <>
      <div className="docs-content min-w-0 max-w-none break-words">
        <MarkdownBlocks
          tokens={parsed.before}
          article={article}
          headingIds={ids}
        />
      </div>
      {parsed.faqTitle && parsed.faqs.length ? (
        <div className="not-prose my-12">
          <TemplateLandingFaq
            eyebrow={t("campaign.faqs")}
            title={parsed.faqTitle}
            idPrefix="article-faq"
            items={parsed.faqs.map((faq) => ({
              id: faq.id,
              question: <span id={faq.id}>{faq.q}</span>,
              answer: (
                <div className="docs-content max-w-none">
                  <MarkdownBlocks tokens={faq.answer} article={article} />
                </div>
              ),
            }))}
          />
        </div>
      ) : null}
      <div className="docs-content min-w-0 max-w-none break-words">
        <MarkdownBlocks
          tokens={parsed.after}
          article={article}
          headingIds={ids}
        />
      </div>
    </>
  );
}
