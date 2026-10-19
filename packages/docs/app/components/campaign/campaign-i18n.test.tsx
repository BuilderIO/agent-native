import {
  AgentNativeI18nProvider,
  useT,
  type LocaleCode,
} from "@agent-native/core/client/i18n";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { docsI18nCatalog, loadDocsMessages } from "../../i18n";
import { CampaignDate } from "./shared";

function Probe({ keyName, count }: { keyName: string; count: number }) {
  const t = useT();
  return <>{t(keyName, { count })}</>;
}

async function render(locale: LocaleCode, node: React.ReactNode) {
  const messages = await loadDocsMessages(locale);
  return renderToStaticMarkup(
    <AgentNativeI18nProvider
      catalog={docsI18nCatalog}
      initialLocale={locale}
      initialMessages={messages}
      persistPreference={false}
    >
      {node}
    </AgentNativeI18nProvider>,
  );
}

describe("campaign plural messages", () => {
  it.each([
    [0, "0 مقالات", "0 دقيقة للقراءة"],
    [1, "1 مقال", "1 دقيقة للقراءة"],
    [2, "2 مقالان", "2 دقيقتان للقراءة"],
    [3, "3 مقالات", "3 دقائق للقراءة"],
    [11, "11 مقالًا", "11 دقيقة للقراءة"],
    [100, "100 مقال", "100 دقيقة للقراءة"],
  ])("selects the Arabic form for %i", async (count, articles, readTime) => {
    expect(
      await render(
        "ar-SA",
        <Probe keyName="campaign.articleCount" count={count} />,
      ),
    ).toBe(articles);
    expect(
      await render(
        "ar-SA",
        <Probe keyName="campaign.readTime" count={count} />,
      ),
    ).toBe(readTime);
  });

  it.each([
    [1, "1 article", "1 min read"],
    [2, "2 articles", "2 min read"],
  ])("selects the English form for %i", async (count, articles, readTime) => {
    expect(
      await render(
        "en-US",
        <Probe keyName="campaign.articleCount" count={count} />,
      ),
    ).toBe(articles);
    expect(
      await render(
        "en-US",
        <Probe keyName="campaign.readTime" count={count} />,
      ),
    ).toBe(readTime);
  });

  it.each([
    ["fr-FR", 1, "1 article"],
    ["fr-FR", 2, "2 articles"],
    ["ja-JP", 1, "1 件の記事"],
    ["ja-JP", 5, "5 件の記事"],
  ] as const)("selects the %s form for %i", async (locale, count, expected) => {
    expect(
      await render(
        locale,
        <Probe keyName="campaign.articleCount" count={count} />,
      ),
    ).toBe(expected);
  });
});

describe("CampaignDate kind", () => {
  it.each([
    [undefined, "Updated January 2, 2026"],
    ["updated", "Updated January 2, 2026"],
    ["published", "Published January 2, 2026"],
  ] as const)("renders %s", async (kind, text) => {
    const html = await render(
      "en-US",
      <CampaignDate date="2026-01-02" kind={kind} />,
    );
    expect(html).toContain('dateTime="2026-01-02"');
    expect(html).toContain(text);
  });
});
