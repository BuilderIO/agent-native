---
title: "MCP アプリ"
description: "実際のアプリ ルート、埋め込みブリッジ、およびホスト ブリッジ API を使用して、対話型 MCP アプリ UI を Claude、ChatGPT、およびその他の互換性のあるホスト内に作成および埋め込みます。"
---

# MCP アプリ

**このページ: Claude/ChatGPT のインライン UI。** MCP アプリ リソースの作成と、互換性のあるホストのチャット内で実際のアプリ ルートをレンダリングする埋め込みブリッジ。このページは、**クライアント サポート マトリックス** ([below](#client-support)) の単一のホームでもあります。

| もしご希望であれば…                                                          | 読む                                     |
| ---------------------------------------------------------------------------- | ---------------------------------------- |
| 外部エージェント/ホストをアプリに接続する                                    | [External Agents](/docs/external-agents) |
| エージェントにさらに多くのツールを提供します (他の MCP サーバーを使用します) | [MCP Clients](/docs/mcp-clients)         |
| Claude/ChatGPT でレンダリングするインライン UI を構築する                    | **このページ** — MCP アプリ              |
| 下位レベルの MCP サーバー参照 (認証、ツール、カスタム マウント)              | [MCP Protocol](/docs/mcp-protocol)       |

MCP アプリは、互換性のあるホスト (Claude、Claude デスクトップ、ChatGPT、VS Code GitHub Copilot、Goose、Postman、MCPJam、および Cursor) がチャット内でインタラクティブな UI をレンダリングできるようにする公式 `io.modelcontextprotocol/ui` 拡張機能です。エージェント ネイティブ アプリでは、すべての MCP アプリは **実際の React ルート**であり、個別のプレーン HTML ウィジェットではありません。

Agent-Native アプリ独自のチャット内では、表、グラフ、入力された結果、承認アフォーダンスなどのファーストパーティ ウィジェットには [native chat renderers](/docs/native-chat-ui) を優先します。 Claude、ChatGPT、Copilot、Cursor、およびその他の互換性のあるホストの外部/クロスホスト インライン UI には MCP アプリを使用し、ユニバーサル ディープリンク フォールバックとしてアクション `link` を使用します。

## オーサリング: オプションの MCP アプリ UI {#mcp-apps}

MCP アプリ拡張機能をサポートするホストの場合、アクションは `mcpApp` を使用してインライン UI リソースをアドバタイズすることもできます。これは、外部エージェントがテキストだけではなくインタラクティブなサーフェスをユーザーに渡す必要があるフローの進歩的な機能強化です。たとえば、電子メールの下書きのレビュー、カレンダーの招待状の編集、生成されたダッシュボードのバリエーションからの選択などです。

ユーザーが UI を必要とするときはいつでも、実際の React アプリを `embedRoute()` または `embedApp()` とともに使用します。メンタル モデルは単純です。アクションの `link` ターゲットは、MCP アプリ埋め込みターゲットでもあります。操作を通常のアクション/ツールとして公開し、`link` でフォーカスされたディープ リンクを返し、`mcpApp.resource = embedApp(...)` を追加して、有能なホストが新しいタブを開く代わりに同じルートをインラインでロードできるようにします。両方を同じルートから構築する必要がある場合は、`embedRoute({ title, openLabel, path })` を優先します。これは、1 回の呼び出しから一致する `link` および `mcpApp` フィールドを返す便利なラッパーですが、`embedApp(...)` は、`mcpApp.resource` に直接割り当てる下位レベルのリソースです。

つまり、フルアプリの埋め込みは、一度開いたルートで実行できることはすべて実行できることを意味します。メールの下書きの確認または編集、フィルターされた受信トレイ/検索の表示、カレンダー イベントまたはイベントの下書きを開く、拡張機能ページの読み込み、完全な分析ダッシュボードまたは保存された分析の検査、スライド エディターでのデッキの続行、デザイン プロジェクト/エディターの開きなどです。 MCP アプリ用の 2 番目の状態プロトコルを発明するよりも、URL/ディープリンク パラメーターと既存の `/_agent-native/open` ナビゲーション/アプリ状態ブリッジを優先します。

まれに、適切なターゲットが、アプリ シェル全体ではなく 1 つの共有 React コンポーネントをレンダリングする、集中したアプリ ルートである場合があります。 Analytics の `/chart` ルートがモデルです。URL 内のコンパクトな `SqlPanel` ペイロードを受け取り、ダッシュボードが使用するのと同じグラフ コンポーネントをレンダリングします。これはまだアプリの埋め込みであり、プレーンな HTML MCP アプリではありません。通常のアクション / `open_app({ path, embed: true })` を通じて公開または呼び出し、URL の決定性を維持し、`embedApp()` にそのルートをインラインでレンダリングさせます。

製品 UI 用の 1 回限りのプレーン HTML MCP アプリを手書きしないでください。アクションにカスタム サーフェスが必要な場合は、最初に実際のアプリのルート/コンポーネントを追加または再利用し、そのルートを埋め込みます。

```an-diagram title="MCP アプリ埋め込みラウンドトリップ" summary="アクションのリンク ターゲットは埋め込みターゲットでもあります。有効なホストは、同じ署名済みアプリ ルートをインラインで読み込みます。他の人は全員ディープリンクに戻ります。"
{
  "html": "<div class=\"diagram-embed\"><div class=\"diagram-card\" data-rough><strong>Action</strong><small class=\"diagram-muted\">`link` target = MCP App embed target</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-card\" data-rough><strong>embedApp()</strong><span class=\"diagram-pill accent\">create_embed_session</span><small class=\"diagram-muted\">mints short-lived embed session</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-card\" data-rough><strong>/_agent-native/embed/start</strong><small class=\"diagram-muted\">一回限りのSQL ticketを交換</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-card\" data-rough><strong>Signed app route</strong><span class=\"diagram-pill ok\">実際のReactルート</span><small class=\"diagram-muted\">short-lived browser session</small></div><div class=\"diagram-fallback\"><span class=\"diagram-pill warn\">MCP Apps 非対応</span><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-box\" data-rough>&quot;Open in … &rarr;&quot; deep link</div></div></div>",
"css": ".diagram-embed{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-embed .diagram-card{display:flex;flex-direction:column;gap:6px;padding:14px 16px;min-width:140px}.diagram-embed .diagram-arrow{font-size:22px;line-height:1}.diagram-embed .diagram-fallback{display:flex;flex-direction:column;align-items:center;gap:6px;margin-inline-start:8px}"
}

```

```ts
import { embedApp } from "@agent-native/core";

export default defineAction({
  // ...description, schema, run, link...
  mcpApp: {
    resource: embedApp({
      title: "Review draft",
      description: "Open the generated draft in the real Mail compose UI.",
      iframeTitle: "Agent-Native Mail",
      openLabel: "Open in Mail",
    }),
  },
});
```

```an-annotated-code title="mcpApp リソース構成"
{
  "filename": "actions/review-draft.ts",
  "language": "ts",
  "code": "import { embedApp } from \"@agent-native/core\";\n\nexport default defineAction({\n  // ...description, schema, run, link...\n  mcpApp: {\n    resource: embedApp({\n      title: \"Review draft\",\n      description: \"Open the generated draft in the real Mail compose UI.\",\n      iframeTitle: \"Agent-Native Mail\",\n      openLabel: \"Open in Mail\",\n    }),\n  },\n});",
  "annotations": [
    { "lines": "6", "label": "段階的な強化", "note": "`mcpApp.resource` は、MCP Apps 拡張機能をサポートするホストのインライン UI をアドバタイズします。アクションの `link` ビルダーも保持します。CLI のみの古いホストは UI メタデータを無視し、依然としてディープ リンクを必要とします。" },
    { "lines": "7", "label": "Embed = the link target", "note": "`embedApp()` uses the action's `link` as its launch target: it calls `create_embed_session`, exchanges a one-time SQL ticket at `/_agent-native/embed/start`, and navigates the MCP App frame to the same signed app route." },
    { "lines": "11", "label": "ユニバーサルフォールバックラベル", "note": "`openLabel` is the visible `\"Open in … →\"` text used as the deep-link escape hatch when a host does not render the inline iframe." }
  ]
}
```

MCP サーバーは、拡張機能 `io.modelcontextprotocol/ui` をアドバタイズし、`_meta.ui.resourceUri` と `_meta["ui/resourceUri"]` を `tools/list` に追加し、ChatGPT アプリ SDK 互換性メタデータ (`openai/outputTemplate`、ウィジェット CSP/説明/アクセシビリティ) も発行します。 MIME `text/html;profile=mcp-app` を使用して、HTML から `resources/list`、`resources/templates/list`、および `resources/read` を公開します。標準入出力プロキシはライブ アプリからこれらのリソース ハンドラーを転送するため、デスクトップおよび CLI クライアントは HTTP クライアントと同じリソースを認識します。

`mcpApp` を追加する場合でも、既存の `link` ビルダーを保持します。 CLI のみのクライアント、古いホスト、および MCP アプリをレンダリングしないホストは、UI メタデータを無視しますが、それでも `"Open in … →"` リンクが必要です。 `embedApp()` は、そのリンクを起動ターゲットとして使用し、アプリ専用の `create_embed_session` ヘルパーを呼び出し、`/_agent-native/embed/start` で 1 回限りの SQL チケットを交換し、短期間のブラウザー セッションと同一オリジン フェッチのベアラー フォールバックを使用して、MCP アプリ フレームをターゲット ルートにナビゲートします。 `open_app({ app, path, embed: true })` は、完全なダッシュボード、フィルターされた受信トレイ、カレンダーの下書きビュー、分析、拡張ページなどのルートの一般的なエスケープ ハッチであり、完全なアプリが最も明確なレビュー/編集画面である場合には積極的に使用する必要があります。

`embedApp()` には、リソース CSP に MCP リクエスト起点が含まれているため、ランチャーは署名されたファーストパーティ アプリ ルートをフェッチし、明示的にリクエストされた場合はフレーム化できます。 Dispatch は、付与されたアプリの正確なオリジンを `open_app` リソースに追加するため、すべての HTTPS オリジンを許可することなく、単一の Dispatch コネクタでメール、カレンダー、スライドなどをインライン化できます。サードパーティ プレーヤーを実際に埋め込むか、サードパーティ アセットをロードするカスタム MCP アプリに対してのみ、追加のフレームまたはリソース ドメインを渡します。

これらの `embedApp()` ルート内では、`sendToAgentChat()` は埋め込みを認識します。自動送信されたプロンプトは、`ui/update-model-context` と `ui/message` として MCP ホストに中継されるため、埋め込みアプリのボタンは、選択したアプリの状態から Claude/ChatGPT の会話を意図的に継続できます。非表示のコンテキストはモデル コンテキストとして送信されます。表示されるユーザーのターンはアプリのプロンプトのみであるため、内部のアプリ状態ファイル パスに関する恐ろしいホストの同意が回避されます。 `submit: false` はローカルの事前入力/レビュー動作のままです。

## ファーストクラス MCP アプリ ブリッジ {#mcp-app-bridge}

MCP アプリの埋め込みはルートの埋め込みであり、個別のミニ製品ではありません。 `embedApp()` は、アクションの `link` ターゲットから開始され、短期間の埋め込みセッションを作成し、署名されたアプリ ルートを起動します。標準 MCP アプリ ホストは、ホストがルートを直接ハイドレートできる場合、MCP アプリ フレーム自体をナビゲートできます。

```an-diagram title="2 つのホスト ブリッジ パス、1 つの署名済みルート" summary="クロードは水和ルートを移植し、直接 ui/_bridge を使用します。 ChatGPT は、window.openai 経由で制御された iframe を取得し、postMessage 経由でホスト アクションを中継します。どちらも同じ署名済みアプリ ルートを指します。"
{
  "html": "<div class=\"diagram-bridge\"><div class=\"diagram-col\"><div class=\"diagram-card\" data-rough><strong>Claude web</strong><span class=\"diagram-pill accent\">single-frame transplant</span><small class=\"diagram-muted\">Claudeのiframeで署名済みアプリHTMLをhydrateし、その後直接`ui/_`ホストブリッジ</small></div><div class=\"diagram-card\" data-rough><strong>ChatGPT web</strong><span class=\"diagram-pill accent\">controlled route iframe</span><small class=\"diagram-muted\">`window.openai`host APIs ·`agentNative.mcpHost.*` postMessage relay</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough>Same signed app route<br><small class=\"diagram-muted\">通常ルート + React コンポーネント</small></div></div>",
"css": ".diagram-bridge{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.diagram-bridge .diagram-col{display:flex;flex-direction:column;gap:12px}.diagram-bridge .diagram-card{display:flex;flex-direction:column;gap:6px;padding:14px 16px;max-width:300px}.diagram-bridge .diagram-arrow{font-size:22px;line-height:1}.diagram-bridge .diagram-box{padding:16px 18px;text-align:center}"
}

```

Claude Web は単一フレーム移植パスを使用します。リソース ドキュメントは署名済みアプリ HTML を取得し、それを Claude の MCP アプリ iframe 内にハイドレートします。これは、Claude がアプリ所有の子 iframe または外部フレーム ナビゲーションを確実に許可しないためです。 ChatGPT Web は、アプリ ブリッジが安定した `window.openai` ホスト API と制限された高さ制御を提供するため、制御されたルート iframe を取得します。すべてのパスは同じ署名済みアプリ ルートを指し、通常のルートと React コンポーネントをレンダリングします。同じ署名付き URL でリロードすると同じビューが再構築されるように、埋め込みルートを設計します。

同じアプリ `open_app({ embed: true })` の場合、フレームワークは元のツール呼び出し中に埋め込み開始チケットを作成し、署名された開始 URL を非表示のツール メタデータに保存します。カスタム actions は、同じ高速パスに対して `embedStartUrl` を返すことができます。 MCP レイヤーは、チケットを含む URL をモデルに表示される `structuredContent` および通常のオープンリンク メタデータから削除します。埋め込み開始 URL が存在しない場合、リソースはアプリ専用の `create_embed_session` ヘルパーにフォールバックします。これにより、実稼働ホストは、ワンタイム アプリ セッション URL をトランスクリプトに漏らすことなく、iframe によって開始されるツール呼び出しを直接ルートで制限するようになります。 1 回限りの開始チケットの有効期限が切れた後にユーザーが古いチャットを再度開くと、開始ルートは小さな更新ページを返し、`agentNative.embedSessionExpired` をラッパーにポストします。 `embedApp()` は、古い開始 URL をクリアし、元のアプリ ルートがまだ残っている場合に、`create_embed_session` を通じて新しいチケットを作成します。

ChatGPT は、`window.openai` を通じて専用の互換性パスを取得します。起動ドキュメントは、`toolInput`、`toolOutput`、および `toolResponseMetadata` を直接読み取り、その後、`window.openai.callTool(...)` 経由で `create_embed_session` を呼び出します。標準の MCP アプリ ホストは、`ui/*` JSON-RPC ブリッジを使用します。直接ハイドレートされたルートは、ホスト ブリッジ ヘルパーを通じて `ui/update-model-context`、`ui/message`、`ui/open-link`、および `ui/request-display-mode` を呼び出すことができます。 Claude の移植ルートは、ハイドレーション後に同じ直接 `ui/*` ホスト ブリッジを使用します。 ChatGPT または明示的な診断 iframe パスが使用される場合、ラッパーは `agentNative.mcpHost.*` postMessage リクエストを介して同じホスト actions を中継します。両方のパスで結果の形状を同一に保ちます。焦点を絞った `link` と簡潔な構造化コンテンツを返します。

標準の `_meta.ui.domain` をアプリ URL に設定しないでください。 MCP アプリはそのフィールドをホスト固有として扱います。Claude は `{hash}.claudemcpcontent.com` スタイルのサンドボックス ドメインを検証しますが、ChatGPT は独自の `openai/widgetDomain` メタデータを使用します。意図的にホスト固有の値を発行する場合を除き、`ui.domain` を省略します。ホストはデフォルトのサンドボックスオリジンを選択します。

拡張ページは、2 番目のルート iframe をナビゲートせずに、MCP チャット埋め込み内にサンドボックスを保持します。通常のアプリの使用では、`/_agent-native/extensions/:id/render` がサンドボックス化された子 iframe としてレンダリングされます。 MCP チャット ブリッジ モードでは、フレームワークはルート iframe 内でサンドボックス化された `srcDoc` と同じ拡張ドキュメントをレンダリングし、`sandbox="allow-scripts allow-forms"` を維持しながらホスト `frame-ancestors` / `X-Frame-Options` の障害を回避します。

リソース シェルは外部ホスト サイズを所有します。 `embedApp({ height })` のデフォルトは `560px` で、シェルを `320-900px` にクランプし、小さいツールバー用に `44px` を予約するため、ルート ビューポートは `height - 44px` になります。埋め込まれたアプリのルートを内部でスクロール可能な状態に保ち、ランチャーがドキュメント全体の高さではなく、制限された固有の高さを報告できるようにします。そうしないと、ホストの自動サイズ変更により、通常のアプリ ページが非常に縦長のチャット アーティファクトに変わってしまう可能性があります。変更されたシェルは、新しい MCP アプリ リソースと新しいツール呼び出しにのみ影響します。古い ChatGPT/Claude 会話フレームは以前のリソースの動作を保持している可能性があるため、修正を判断する前に新しいインライン レンダリングでサイズを確認してください。

### 埋め込みモード {#embed-modes}

Claude は、デフォルトで単一フレーム移植パスを使用します。ホストのモジュール読み込み動作をデバッグするときに、`embedMode: "transplant"` または `frame: "transplant"` を使用して他のホストで強制することもできます。 `embedMode: "iframe"`、`renderMode: "iframe"`、`nested: true`、または `frame: "iframe"` を使用して、ネストされた診断 iframe を強制できます。 iframe がブロックされている場合、`embedApp()` はそれをオープンアプリのフォールバックに置き換えます。ユーザーはインラインで再試行するか、ホスト経由で新たに生成された埋め込みセッションを開くか、表示可能なルート URL を使用できます。アクションの `link` ターゲットは、依然として万能の脱出ハッチであるため、単独で有用なままにしておきます。

ngrok を通じて Claude をテストする場合は、実稼働ビルド (`npx @agent-native/core@latest build`、次に `npx @agent-native/core@latest start`) またはデプロイされたプレビュー/実稼働 URL を使用します。 Claude の単一フレーム移植パスは、実稼働アセット チャンクで動作します。 `/app/root.tsx` などの生の Vite 開発モジュールはアプリ認証によって保護され、Claude リソース オリジンからの動的インポートに失敗する可能性があります。

## ホストブリッジ API {#host-bridge}

ホスト ブリッジは意図的に小さくなっています:

| モード                  | メッセージタイプ                      | 次の目的で使用してください                                |
| ----------------------- | ------------------------------------- | --------------------------------------------------------- |
| 直接ホスト ルート       | `ui/update-model-context`             | ホスト モデルの非表示コンテキスト                         |
| 直接ホスト ルート       | `ui/message`                          | 表示されているユーザーが主催者になることを投稿            |
| 直接ホスト ルート       | `ui/open-link`                        | ホスト経由で外部またはアプリ URL を開きます               |
| 直接ホスト ルート       | `ui/request-display-mode`             | `inline`、`fullscreen`、または `pip` をリクエスト         |
| Claude 移植             | `ui/*`                                | 水和後の同じ直接ホストブリッジ                            |
| ChatGPT / iframe ルート | `agentNative.mcpHostContext`          | テーマ、ロケール、ホスト プラットフォーム、ディメンション |
| ChatGPT / iframe ルート | `agentNative.embeddedAppReady`        | ルート iframe がロードされていることを確認します          |
| ChatGPT / iframe ルート | `agentNative.mcpHost.*` / `.response` | ホストリクエストのラッパーリレー                          |

埋め込みルートは、`@agent-native/core/client` から `updateMcpAppModelContext()`、`openMcpAppHostLink()`、`requestMcpAppDisplayMode()`、`getMcpAppHostContext()`、および `useMcpAppHostContext()` を使用できます。 `sendToAgentChat()` は、自動送信プロンプトにフルアプリ埋め込みからの同じパスを使用します。

表示モードはベストエフォートです。アプリ内 `McpAppRenderer` は現在、インライン Web ホスト コンテキストとインライン専用表示モードをレポートします。外部ホストは、より大きな表示要求を受け入れたり、無視したり、サポートされていないモードのエラーを返したりすることがあります。インライン ルートは常に使用可能な状態にしておきます。

## クライアントのサポートとキャッシュ {#client-support}

現在の公式 MCP アプリ クライアント リストには、Claude、Claude デスクトップ、VS Code GitHub Copilot、Goose、Postman、MCPJam、ChatGPT、および Cursor が含まれています。ホストのサポートはプラン、リリース チャネル、クライアントのバージョンによって異なるため、[MCP extension support matrix](https://modelcontextprotocol.io/extensions/client-matrix) を確認してください。 ChatGPT カスタム MCP アプリは、ChatGPT Web 上の Business および Enterprise/Edu ワークスペースの開発者モードを通じて利用できます。 OpenAI の [developer mode and MCP apps](https://help.openai.com/en/articles/12584461-developer-mode-and-full-mcp-apps-in-chatgpt-beta) メモを参照してください。

Claude コード、Codex、およびその他の CLI/コードエディター クライアントは、MCP アプリをサポートする場合でも同じリソースとメタデータを受け取りますが、その正確なサーフェスでのインライン iframe レンダリングを検証していない限り、それらをリンクアウト ホストとして扱います。ホストが iframe をレンダリングしないことを選択した場合でも、ディープ リンクは信頼性の高いフォールバックとして残ります。実際には、すべてのエージェント ネイティブ アプリは、対応ホストでのインライン レビュー/編集用の MCP アプリと、完全なアプリへのユニバーサル ラウンドトリップ用の `link` の両方を使用して作成する必要があります。

Claude および ChatGPT は、既存のカスタム コネクタのツールとリソースのメタデータをキャッシュできます。 MCP アプリのメタデータを変更した後、新しいツール呼び出しで検証します。ホストがまだ古い記述子を使用している場合は、Claude コネクタを再接続するか、ChatGPT コネクタを再スキャン/レビューして、カタログを更新します。デプロイ後に Claude がツール記述子に存在する `_meta.ui.csp` または `_meta.ui.permissions` に関する警告をログに記録する場合、そのコネクタは古いメタデータを使用しています。Claude コネクタを削除または再接続し、新しいチャットを開始してください。

## テスト {#testing}

`embedApp()` および `McpAppRenderer` 周辺の軽量フィクスチャを使用して MCP アプリをテストします。実際の外部ホストを必要とせずに、CSP、ホスト コンテキスト、アプリの起動、ブリッジ メッセージの動作をカバーします。 ChatGPT または Claude Web を検証する場合、シェルの変更後に新しいツール呼び出しをトリガーし、表示される iframe を測定します。同じ会話内で以前にレンダリングされたフレームには、キャッシュされた高さまたは起動動作が引き続き表示される場合があります。

## 関連 {#related}

- [External Agents](/docs/external-agents) — Claude、ChatGPT、Codex、および Cursor をホストされたアプリに接続します。 MCP アプリ互換性マトリックス;カタログ階層。ディープリンク。
- [MCP Protocol](/docs/mcp-protocol) — 自動マウントされた MCP サーバー、認証、ツール、および `ask-agent`。
- [Actions](/docs/actions) — `defineAction`、`link` ビルダー、`publicAgent`。

```

```
