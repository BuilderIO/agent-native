---
title: "觀察記憶"
description: "背景三層壓縮（最近的原始→觀察→反射），使長代理對話串保持廉價且提示快取穩定，而無需觸及短對話。"
---

# 觀察記憶

長時間執行的代理對話串會積累巨大的紀錄：每條訊息、每個工具呼叫、每個結果。每回合將整個歷史紀錄重播到模型中的成本很高，並且最終會破壞脈絡視窗。 **觀察記憶 (OM)** 將長對話串的較舊部分壓縮為過時的分層摘要，因此模型仍然知道發生了什麼 - 只需權杖成本的一小部分 - 而最近的回合則保持逐字紀錄。

OM 是完全自動的且僅限於所有者範圍。 **短對話串不受影響**：線上程跨越第一個壓縮閾值之前，OM 是無操作的，並且脈絡是逐位元組的，沒有它時的情況。

## 三層 {#tiers}

OM 將長對話串表示為三層，從最精煉到最近：

| 層級               | 它是什麼                                                                  |
| ------------------ | ------------------------------------------------------------------------- |
| **思考**           | 最進階別，由觀察記錄變大後濃縮而成。長弧總結。                            |
| **觀察**           | 密集、過時的條目將一段原始訊息折疊成所發生事件的緊湊紀錄。                |
| **最近的原始訊息** | 最後 N 個回合，**逐字**儲存 — 從未折疊 — 因此代理始終可以看到最新的脈絡。 |

```an-diagram title="三層，提煉到最近" summary="較舊的前綴折疊成過時的觀察結果和長弧反射；只有最近的輪次才保留原樣。"
{
  "html": "<div class=\"om\"><div class=\"diagram-card\"><span class=\"diagram-pill\">反思</span><small class=\"diagram-muted\">從觀察記錄濃縮出的長期摘要</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&uarr;</div><div class=\"diagram-card\"><span class=\"diagram-pill accent\">觀察</span><small class=\"diagram-muted\">帶日期的密集條目，折疊多段原始訊息</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&uarr;</div><div class=\"diagram-card\"><span class=\"diagram-pill ok\">最近的原始訊息</span><small class=\"diagram-muted\">last N turns, kept <strong>verbatim</strong> — 永不折疊</small></div></div>",
  "css": ".om{display:flex;flex-direction:column-reverse;align-items:stretch;gap:8px}.om .diagram-card{display:flex;flex-direction:column;gap:4px;padding:12px 16px}.om .diagram-arrow{text-align:center;font-size:20px;line-height:1}"
}
```

在每一輪中，讀取端將它們組裝成一個自標記的 `[Observational Memory]` 塊，該塊替換原始的較舊前綴，保持最近原始視窗完整，並告訴模型將壓縮紀錄視為權威（不要重做已完成的工作，信任紀錄的決策、名稱、日期和狀態）。

## 壓縮如何執行 {#compaction}

兩次傳遞以“即發即忘、盡力而為”的方式執行，在一次幹淨的轉彎之後，因此它們不會給使用者可見的回應增加延遲，並且任何失敗都會被吞掉：

1. **觀察者** - 一旦對話串的*unobserved*訊息超過觀察標記閾值，將它們折疊成單一密集觀察條目。
2. **Reflector** — 一旦持久觀察記錄本身超過反射權杖閾值，就會將觀察結果壓縮為更進階別的反射。

```an-diagram title="幹淨利落的轉彎後兩次盡力傳球" summary="每次傳遞都不會低於其閾值，因此每輪執行壓縮器都很便宜。故障會被吞掉，並且不會增加延遲。"
{
  "html": "<div class=\"om-pass\"><div class=\"diagram-node\">幹淨回合結束<br><small class=\"diagram-muted\">fire-and-forget</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-card\"><span class=\"diagram-pill accent\">Observer</span><small class=\"diagram-muted\">unobserved tokens &gt; 30k? &rarr; fold into one observation</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-card\"><span class=\"diagram-pill accent\">Reflector</span><small class=\"diagram-muted\">observation log &gt; 40k? &rarr; condense into a reflection</small></div></div>",
  "css": ".om-pass{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.om-pass .diagram-node,.om-pass .diagram-card{display:flex;flex-direction:column;gap:2px;padding:10px 14px}.om-pass .diagram-arrow{font-size:22px;line-height:1}"
}
```

兩者都透過低於其閾值的無操作，因此在每輪之後呼叫壓縮器是便宜的。由於 OM 用穩定的壓縮文字替換了易失的原始前綴，因此它還可以在長對話串的輪流中保持提示**快取穩定**。

OM 資料存在於應用程式自己的 SQL 資料庫中，其範圍僅限於所有者（以及存在的組織）——與框架的其餘部分具有相同的範圍模型。它永遠不會在使用者之間共用。

## 設定 {#config}

預設值是保守的。操作者可以在部署時使用 `AGENT_NATIVE_OM_*` 環境變數進行壓縮（無需重新部署應用程式的程式碼）；無效或缺失的值始終會回退到指定的預設值。

| 環境變數                                      | 預設    | 它控制什麼                                           |
| --------------------------------------------- | ------- | ---------------------------------------------------- |
| `AGENT_NATIVE_OM_OBSERVATION_TOKEN_THRESHOLD` | `30000` | 未觀察到的訊息標記，觸發觀察者將它們折疊成一個觀察。 |
| `AGENT_NATIVE_OM_REFLECTION_TOKEN_THRESHOLD`  | `40000` | 觸發反射器凝結成反射的觀察記錄標記。                 |
| `AGENT_NATIVE_OM_RECENT_RAW_MESSAGE_COUNT`    | `12`    | 有多少最新訊息會逐字保留（從未合併到觀察中）。       |

觀察者和反射器輸出上限（4000 / 2000 代幣）可防止單次壓縮傳遞超出預算；它們可以透過 `resolveObservationalMemoryConfig({ ... })` 在程式碼中進行調整，但不能暴露在環境中。

> [!TIP]
> 降低閾值以更快地壓縮（更便宜的長對話串，稍微更多的摘要）；在壓縮之前提高它們以在脈絡中保留更多原始歷史紀錄。如果您的工作流程需要更長的逐字尾部，請將 `AGENT_NATIVE_OM_RECENT_RAW_MESSAGE_COUNT` 設定得更高。

## 當它開始時 {#when}

OM 僅更改足夠長的對話串的行為，以產生至少一個觀察或反射。具體來說：

- 一個全新的或短的對話串：還沒有 OM 條目 → 脈絡是純文字，未更改。
- 長對話串已超過觀察閾值：較舊的前綴被壓縮的 `[Observational Memory]` 塊替換，最近的原始尾部保持原樣，並且權杖使用量大幅下降。

注入是盡力而為且邊界安全的 - 如果找不到安全調整點（例如，待處理的工具使用/結果對位於視窗邊緣），OM 將*附加*注入記憶塊而不進行調整，而不是冒險丟棄待處理的工具結果。

## 相關

- [**Using Your Agent**](/docs/using-your-agent) — 與停靠在您的應用旁邊的代理一起工作的日常迴圈。
- [**Observability**](/docs/observability) — 每次執行的權杖和成本指標，其中顯示 OM 的節省。
- [**Custom Agents & Teams**](/docs/agent-teams) - 長子代理執行受益於相同的壓縮。
