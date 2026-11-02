import { useLocale, useT } from "@agent-native/core/client/i18n";
import { marked, type Token, type Tokens } from "marked";
import { Fragment, type ReactNode } from "react";
import { Link } from "react-router";

import { TemplateLandingFaq } from "../template-landing";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "../ui/dialog";
import { CodeBlock } from "../website-redesign/ds/code-block";
import { campaignHref, safeHref, type Article } from "./public-content";
import { CampaignCallout, CopyControl } from "./shared";

export function sanitizedMarkdown(body: string): string {
  const source = body.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "");
  const tokens = marked.lexer(source);
  return tokens
    .map((token) => {
      if (token.type === "html") return "";
      return token.raw;
    })
    .join("");
}

// Marks (\p{M}) carry Devanagari vowel signs and Arabic diacritics; dropping
// them turns a Hindi heading's id into a different word.
export function headingId(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s-]/gu, "")
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

function inline(tokens: Token[] | undefined, locale: unknown): ReactNode {
  return requiredTokens(tokens).map((token, i) => {
    let node: ReactNode;
    switch (token.type) {
      case "strong":
        node = <strong>{inline(token.tokens, locale)}</strong>;
        break;
      case "em":
        node = <em>{inline(token.tokens, locale)}</em>;
        break;
      case "del":
        node = <del>{inline(token.tokens, locale)}</del>;
        break;
      case "codespan":
        node = <code>{token.text}</code>;
        break;
      case "br":
        node = <br />;
        break;
      case "link": {
        const href = safeHref(decodeText(token.href));
        const label = inline(token.tokens, locale);
        node = !href ? (
          label
        ) : href.startsWith("/") && !href.startsWith("//") ? (
          <Link to={campaignHref(href, locale)}>{label}</Link>
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
            decoding="async"
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
            ? inline(token.tokens, locale)
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
  // The questions are the article's last "##" section.
  let start = -1;
  for (const [i, token] of tokens.entries())
    if (token.type === "heading" && token.depth === 2) start = i;
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

const STEP = /^(\d+)\.\s+/;

// "### 1. Pull the numbers": the number becomes a badge, the rest stays the heading.
function withoutStepNumber(tokens: Token[] | undefined): Token[] {
  return requiredTokens(tokens).map((token, i) => {
    if (i > 0 || token.type !== "text") return token;
    const text = token.text.replace(STEP, "");
    return { ...token, raw: text, text, tokens: undefined } as Token;
  });
}

// The "##" section's numbered steps, for the list of steps under its heading.
function stepsAfter(tokens: Token[], index: number) {
  const steps: { id: string; title: string }[] = [];
  for (const token of tokens.slice(index + 1)) {
    if (token.type !== "heading") continue;
    if (token.depth <= 2) break;
    const title = inlineText(token.tokens);
    if (token.depth === 3 && STEP.test(title))
      steps.push({ id: headingId(title), title: title.replace(STEP, "") });
  }
  return steps;
}

export function MarkdownBlocks({
  tokens,
  article,
  headingIds = new Map<string, number>(),
  stepList,
}: {
  tokens: Token[];
  article: Article;
  headingIds?: Map<string, number>;
  /** The index of the "##" heading that gets a list of its steps. */
  stepList?: number;
}) {
  const { locale } = useLocale();
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
            const step =
              token.depth === 3
                ? STEP.exec(inlineText(token.tokens))?.[1]
                : undefined;
            const steps = i === stepList ? stepsAfter(tokens, i) : [];
            node = (
              <>
                <Heading
                  id={id}
                  className={`group scroll-mt-24 flex items-start gap-2${step ? " article-step-heading" : ""}`}
                >
                  {step ? (
                    <>
                      <span className="article-step-number" aria-hidden="true">
                        {step.padStart(2, "0")}
                      </span>
                      <span className="sr-only">{`${step}. `}</span>
                    </>
                  ) : null}
                  {inline(
                    step ? withoutStepNumber(token.tokens) : token.tokens,
                    locale,
                  )}
                  <CopyControl text={id} heading />
                </Heading>
                {steps.length ? (
                  <ol className="article-step-list">
                    {steps.map((item) => (
                      <li key={item.id}>
                        <a href={`#${item.id}`}>{item.title}</a>
                      </li>
                    ))}
                  </ol>
                ) : null}
              </>
            );
            break;
          }
          case "paragraph": {
            // A paragraph that is only a screenshot shows the reader's theme.
            const only = token.tokens?.filter(
              (child) => !(child.type === "text" && !child.raw.trim()),
            );
            const first = only?.length === 1 ? only[0] : undefined;
            const image =
              first?.type === "image"
                ? article.images.find((item) => item.dark === first.href)
                : undefined;
            node = image ? (
              <ArticleImage image={image} />
            ) : (
              <p>{inline(token.tokens, locale)}</p>
            );
            break;
          }
          case "text":
            node = (
              <>{token.tokens ? inline(token.tokens, locale) : token.text}</>
            );
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
              <div className="article-table max-w-full overflow-x-auto">
                <table>
                  <thead>
                    <tr>
                      {(token as Tokens.Table).header.map((cell, n) => (
                        <th key={n}>{inline(cell.tokens, locale)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(token as Tokens.Table).rows.map((row, n) => (
                      <tr key={n}>
                        {row.map((cell, c) => (
                          <td key={c}>{inline(cell.tokens, locale)}</td>
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
            node = null;
            break;
          default:
            node = null;
        }
        return <Fragment key={i}>{node}</Fragment>;
      })}
    </>
  );
}

// Both themes of one screenshot, stacked; the site's theme classes show the right one.
function ThemedImage({
  dark,
  light,
  alt,
}: {
  dark: string;
  light: string;
  alt: string;
}) {
  return (
    <>
      <img
        src={dark}
        alt={alt}
        loading="lazy"
        decoding="async"
        className="theme-img-dark absolute inset-0 block h-full w-full object-contain"
      />
      <img
        src={light}
        alt=""
        aria-hidden="true"
        loading="lazy"
        decoding="async"
        className="theme-img-light absolute inset-0 block h-full w-full object-contain"
      />
    </>
  );
}

// A 16:9 screenshot; clicking it opens it as large as the window allows.
function ArticleImage({ image }: { image: Article["images"][number] }) {
  const t = useT();
  const dark = safeHref(image.dark);
  const light = safeHref(image.light);
  if (!dark || !light) return null;
  return (
    <figure className="not-prose my-8">
      <Dialog>
        <DialogTrigger asChild>
          <button
            type="button"
            className="article-image relative block aspect-video w-full cursor-zoom-in overflow-hidden rounded-[var(--b-radius)] border border-solid border-[var(--b-border-default)] bg-[var(--b-bg-raised)] p-0"
          >
            <ThemedImage dark={dark} light={light} alt={image.alt} />
            <span className="sr-only">{t("campaign.enlargeImage")}</span>
          </button>
        </DialogTrigger>
        <DialogContent
          aria-describedby={undefined}
          className="builder-brand-tokens article-image-zoom max-w-none"
        >
          <DialogTitle className="sr-only">{image.alt}</DialogTitle>
          <DialogClose asChild>
            <button
              type="button"
              className="relative block aspect-video w-full cursor-zoom-out overflow-hidden rounded-[var(--b-radius)] bg-[var(--b-bg-raised)] p-0"
            >
              <ThemedImage dark={dark} light={light} alt={image.alt} />
              <span className="sr-only">{t("campaign.closeImage")}</span>
            </button>
          </DialogClose>
        </DialogContent>
      </Dialog>
    </figure>
  );
}

export function ArticleBody({ article }: { article: Article }) {
  const parsed = parseArticle(article.body);
  const ids = new Map<string, number>();
  // The intro (and its image) comes before the first "##"; the app's callout follows it.
  const firstSection = parsed.before.findIndex(
    (token) => token.type === "heading" && token.depth === 2,
  );
  const split = firstSection < 0 ? parsed.before.length : firstSection;
  const sections = parsed.before.slice(split);
  const stepList = sections.findIndex(
    (token, i) =>
      token.type === "heading" &&
      token.depth === 2 &&
      stepsAfter(sections, i).length >= 3,
  );
  return (
    <div className="campaign-article-content">
      <div className="docs-content min-w-0 max-w-none break-words">
        <MarkdownBlocks
          tokens={parsed.before.slice(0, split)}
          article={article}
          headingIds={ids}
        />
        <CampaignCallout item={article} location="inline" />
        <MarkdownBlocks
          tokens={sections}
          article={article}
          headingIds={ids}
          {...(stepList < 0 ? {} : { stepList })}
        />
      </div>
      {parsed.faqTitle && parsed.faqs.length ? (
        <div className="campaign-article-faq not-prose my-12">
          <TemplateLandingFaq
            layout="stacked"
            eyebrow={null}
            title={parsed.faqTitle}
            headingId={headingId(parsed.faqTitle)}
            headingAction={
              <CopyControl text={headingId(parsed.faqTitle)} heading />
            }
            idPrefix="article-faq"
            items={parsed.faqs.map((faq) => ({
              id: faq.id,
              question: faq.q,
              headingId: faq.id,
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
    </div>
  );
}
