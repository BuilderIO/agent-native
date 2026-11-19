import { Linking, Platform, Text, View } from "react-native";

import { useAppPanelLink } from "./AppPanelLinkContext";
import {
  FadeInStaggeredIfStreaming,
  TextFadeInStaggeredIfStreaming,
} from "./StreamingFade";

const MONO_FONT = Platform.select({ ios: "Menlo", android: "monospace" });

type Block =
  | { kind: "paragraph"; text: string }
  | { kind: "heading"; level: number; text: string }
  | { kind: "bullet"; ordered: boolean; items: string[] }
  | { kind: "code"; language: string; code: string };

function parseBlocks(source: string): Block[] {
  const blocks: Block[] = [];
  const lines = source.split("\n");
  let paragraph: string[] = [];
  let code: string[] | null = null;
  let codeLanguage = "";
  let list: { ordered: boolean; items: string[] } | null = null;

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push({ kind: "paragraph", text: paragraph.join("\n") });
      paragraph = [];
    }
  };
  const flushList = () => {
    if (list) {
      blocks.push({ kind: "bullet", ...list });
      list = null;
    }
  };

  for (const line of lines) {
    if (code !== null) {
      if (line.trimEnd().startsWith("```")) {
        blocks.push({
          kind: "code",
          language: codeLanguage,
          code: code.join("\n"),
        });
        code = null;
      } else {
        code.push(line);
      }
      continue;
    }
    const fence = line.match(/^```(\S*)\s*$/);
    if (fence) {
      flushParagraph();
      flushList();
      code = [];
      codeLanguage = fence[1] ?? "";
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push({
        kind: "heading",
        level: heading[1]!.length,
        text: heading[2] ?? "",
      });
      continue;
    }
    const bullet = line.match(/^\s*([-*]|\d+[.)])\s+(.*)$/);
    if (bullet) {
      flushParagraph();
      const ordered = bullet[1] !== "-" && bullet[1] !== "*";
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { ordered, items: [] };
      }
      list.items.push(bullet[2] ?? "");
      continue;
    }
    if (line.trim() === "") {
      flushParagraph();
      flushList();
      continue;
    }
    flushList();
    paragraph.push(line);
  }
  if (code !== null) {
    blocks.push({
      kind: "code",
      language: codeLanguage,
      code: code.join("\n"),
    });
  }
  flushParagraph();
  flushList();
  return blocks;
}

type InlineToken =
  | { kind: "link"; text: string; url: string }
  | { kind: "plain"; text: string }
  | { kind: "bold"; text: string }
  | { kind: "italic"; text: string }
  | { kind: "code"; text: string };

const INLINE_PATTERN =
  /(\[[^\]\n]+\]\(https?:\/\/[^\s)]+\)|https?:\/\/[^\s<>()]+|`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\n]+\*)/g;

function parseInline(text: string, linksOnly = false): InlineToken[] {
  const tokens: InlineToken[] = [];
  let lastIndex = 0;
  const pattern = linksOnly
    ? /(\[[^\]\n]+\]\(https?:\/\/[^\s)]+\)|https?:\/\/[^\s<>()]+)/g
    : INLINE_PATTERN;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      tokens.push({ kind: "plain", text: text.slice(lastIndex, index) });
    }
    const raw = match[0]!;
    const link = raw.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/);
    const linkText = link?.[1];
    const linkUrl = link?.[2];
    if (linkText && linkUrl) {
      tokens.push({ kind: "link", text: linkText, url: linkUrl });
    } else if (/^https?:\/\//.test(raw)) {
      tokens.push({ kind: "link", text: raw, url: raw });
    } else if (raw.startsWith("`")) {
      tokens.push({ kind: "code", text: raw.slice(1, -1) });
    } else if (raw.startsWith("**")) {
      tokens.push({ kind: "bold", text: raw.slice(2, -2) });
    } else {
      tokens.push({ kind: "italic", text: raw.slice(1, -1) });
    }
    lastIndex = index + raw.length;
  }
  if (lastIndex < text.length) {
    tokens.push({ kind: "plain", text: text.slice(lastIndex) });
  }
  return tokens;
}

export function InlineText({
  text,
  className,
  startIndex = 0,
  linksOnly = false,
}: {
  text: string;
  className?: string;
  startIndex?: number;
  linksOnly?: boolean;
}) {
  const onOpenLink = useAppPanelLink();
  const tokens = parseInline(text, linksOnly);
  let cumulativeLength = startIndex;
  return (
    <Text className={className ?? "text-text-light text-[15px] leading-5.5"}>
      {tokens.map((token, index) => {
        const tokenStart = cumulativeLength;
        cumulativeLength += token.text.length;
        if (token.kind === "link") {
          return (
            <Text
              key={index}
              accessibilityRole="link"
              className="text-accent-blue underline"
              onPress={() => {
                if (onOpenLink) {
                  onOpenLink(token.url);
                  return;
                }
                void Linking.openURL(token.url).catch(() =>
                  console.warn("[chat] link could not be opened"),
                );
              }}
            >
              {token.text}
            </Text>
          );
        }
        if (token.kind === "bold") {
          return (
            <Text key={index} className="font-bold text-foreground">
              <TextFadeInStaggeredIfStreaming startIndex={tokenStart}>
                {token.text}
              </TextFadeInStaggeredIfStreaming>
            </Text>
          );
        }
        if (token.kind === "italic") {
          return (
            <Text key={index} className="italic">
              <TextFadeInStaggeredIfStreaming startIndex={tokenStart}>
                {token.text}
              </TextFadeInStaggeredIfStreaming>
            </Text>
          );
        }
        if (token.kind === "code") {
          return (
            <Text
              key={index}
              className="text-accent-green text-[13.5px]"
              style={{ fontFamily: MONO_FONT }}
            >
              <TextFadeInStaggeredIfStreaming startIndex={tokenStart}>
                {token.text}
              </TextFadeInStaggeredIfStreaming>
            </Text>
          );
        }
        return (
          <TextFadeInStaggeredIfStreaming key={index} startIndex={tokenStart}>
            {token.text}
          </TextFadeInStaggeredIfStreaming>
        );
      })}
    </Text>
  );
}

const HEADING_CLASSES: Record<number, string> = {
  1: "text-foreground text-xl font-bold mt-2",
  2: "text-foreground text-lg font-bold mt-2",
  3: "text-foreground text-base font-bold mt-1.5",
  4: "text-foreground text-[15px] font-semibold mt-1",
};

export function MarkdownText({ text }: { text: string }) {
  const blocks = parseBlocks(text);
  let blockOffset = 0;
  return (
    <View className="gap-2">
      {blocks.map((block, index) => {
        const startIndex = blockOffset;
        let blockLength = 0;
        if (block.kind === "paragraph" || block.kind === "heading") {
          blockLength = block.text.length;
        } else if (block.kind === "code") {
          blockLength = block.code.length;
        } else if (block.kind === "bullet") {
          blockLength = block.items.reduce((acc, item) => acc + item.length, 0);
        }
        blockOffset += blockLength + 1;

        if (block.kind === "heading") {
          return (
            <InlineText
              key={index}
              text={block.text}
              startIndex={startIndex}
              className={HEADING_CLASSES[block.level] ?? HEADING_CLASSES[4]}
            />
          );
        }
        if (block.kind === "code") {
          return (
            <FadeInStaggeredIfStreaming key={index}>
              <View className="rounded-lg bg-background-pure border border-border-dark p-2.5">
                <Text
                  className="text-text-light text-[13px] leading-4.5"
                  style={{ fontFamily: MONO_FONT }}
                >
                  {block.code}
                </Text>
              </View>
            </FadeInStaggeredIfStreaming>
          );
        }
        if (block.kind === "bullet") {
          let itemOffset = startIndex;
          return (
            <View key={index} className="gap-1">
              {block.items.map((item, itemIndex) => {
                const bulletItemStart = itemOffset;
                itemOffset += item.length;
                return (
                  <View key={itemIndex} className="flex-row gap-2 pr-2">
                    <Text className="text-status-gray text-[15px] leading-5.5">
                      {block.ordered ? `${itemIndex + 1}.` : "•"}
                    </Text>
                    <View className="flex-1">
                      <InlineText text={item} startIndex={bulletItemStart} />
                    </View>
                  </View>
                );
              })}
            </View>
          );
        }
        return (
          <InlineText key={index} text={block.text} startIndex={startIndex} />
        );
      })}
    </View>
  );
}
