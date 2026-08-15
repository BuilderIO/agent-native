import { Platform, Text, View } from "react-native";

import {
  FadeInStaggeredIfStreaming,
  TextFadeInStaggeredIfStreaming,
} from "./StreamingFade";

/**
 * Minimal streaming-safe markdown renderer. Re-parses the full text each
 * render (messages are short enough that this stays cheap) and never throws
 * on incomplete markup, so it can render mid-stream deltas.
 */

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
  | { kind: "plain"; text: string }
  | { kind: "bold"; text: string }
  | { kind: "italic"; text: string }
  | { kind: "code"; text: string };

const INLINE_PATTERN = /(`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\n]+\*)/g;

function parseInline(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let lastIndex = 0;
  for (const match of text.matchAll(INLINE_PATTERN)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      tokens.push({ kind: "plain", text: text.slice(lastIndex, index) });
    }
    const raw = match[0]!;
    if (raw.startsWith("`")) {
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

function InlineText({
  text,
  className,
  startIndex = 0,
}: {
  text: string;
  className?: string;
  startIndex?: number;
}) {
  const tokens = parseInline(text);
  let cumulativeLength = startIndex;
  return (
    <Text className={className ?? "text-text-light text-[15px] leading-5.5"}>
      {tokens.map((token, index) => {
        const tokenStart = cumulativeLength;
        cumulativeLength += token.text.length;
        if (token.kind === "bold") {
          return (
            <Text key={index} className="font-bold text-white">
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
  1: "text-white text-xl font-bold mt-2",
  2: "text-white text-lg font-bold mt-2",
  3: "text-white text-base font-bold mt-1.5",
  4: "text-white text-[15px] font-semibold mt-1",
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
        blockOffset += blockLength + 1; // spacing offset

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
