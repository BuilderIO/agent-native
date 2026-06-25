---
title: "フレーム"
description: "ローカル開発フレーム、埋め込みエージェント パネル、クラウド フレーム - AI エージェントがアプリと一緒に実行される方法。"
---

# フレーム

すべてのエージェント ネイティブ アプリは、アプリ UI の隣に AI エージェントを使用して実行されます。 **フレーム**は
両方をホストするラッパー: アプリを表示し、エージェントに場所を提供します
チャット、実行、および (開発内で) コードの編集。 3 つのフレームがあり、1 つのランタイムを共有します。

- **埋め込みエージェント パネル** — `@agent-native/core` のすべてのアプリ内に同梱されています。
  これは、開発中および運用中にアプリ自体がレンダリングするサイドバーです。
- **ローカル開発フレーム** — 実行中のアプリを iframe にロードする薄いラッパー
  同じエージェント パネルとその横に統合された CLI 端末を追加します。中古
  このリポジトリ内のテンプレートのローカル開発用。
- **Builder.io クラウド フレーム** — コラボレーションを備えた管理されたホスト型フレーム
  視覚的な編集と並列エージェントの実行。

アプリのコードは、どのフレームがホストするかに関係なく同一です。エージェントが話す
どの場合でも同じ actions とアプリケーションの状態を介してアプリに送信されます。

```an-diagram title="3 つのフレーム、1 つのランタイム" summary="アプリとエージェント パネルはどのフレームでも同じです。それらを囲むラッパーのみが変更されます。"
{
  "html": "<div class=\"diagram-frames\"><div class=\"diagram-card\" data-rough><span class=\"diagram-pill accent\">埋め込みパネル</span><small class=\"diagram-muted\">すべてのアプリに同梱 · dev + prod</small></div><div class=\"diagram-card\" data-rough><span class=\"diagram-pill\">ローカル開発フレーム</span><small class=\"diagram-muted\">iframe内のアプリ + パネル + CLI端末</small></div><div class=\"diagram-card\" data-rough><span class=\"diagram-pill\">Builder.ioクラウドフレーム</span><small class=\"diagram-muted\">ホスト版: 共同作業 · ビジュアル編集 · 並列実行</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-box\" data-rough>同じruntime<br><small class=\"diagram-muted\">あなたのアプリ · アクション · アプリ状態</small></div></div>",
  "css": ".diagram-frames{display:flex;flex-direction:column;gap:10px;align-items:stretch}.diagram-frames .diagram-card{display:flex;flex-direction:column;gap:4px;padding:12px 16px}.diagram-frames .diagram-arrow{font-size:22px;line-height:1;align-self:center}"
}
```

## 埋め込みエージェント パネル {#embedded-agent}

埋め込みパネルは、アプリがレンダリングするエージェント サイドバーです。
`@agent-native/core` — インストールする個別のパッケージはありません — 同一です
開発および本番環境のコンポーネント。

- `@agent-native/core/client` から `AgentPanel` としてエクスポートされ、
  製品版のみのバリアント `ProductionAgentPanel`。
- 完全なチャット / CLI / ワークスペース サーフェスを提供するため、エージェントの入力はオンのままです
  フレームワーク内の他の場所で使用される共有コンポーザ スタック。
- 毎ターン `application_state.navigation` を読み取るので、どれであるかはすでにわかっています
  現在の状況と何が選択されているかを確認します。「これ」について改めて説明する必要はありません。

### アプリ vs コード ツール モード {#tool-modes}

パネルは 2 つのツール モードのいずれかで実行されます:

- **アプリ モード** — エージェントはアプリ独自のツール (actions のみ) を持ちます
  `defineAction` で定義され、ナビゲーションとコンテキストも追加されます。ファイルシステムがない、または
  シェルアクセス。これがエンドユーザーに得られるものです。
- **コード モード** — 共有コーディング ツール (`bash`、`read`、`edit`、`write`) を追加します
  アプリ ツール上でデータベースにアクセスできるため、エージェントはアプリの変更を行うことができます
  独自のソース。コードリクエストはゲートされます: メッセージにコードが必要な場合
  (`type: "code"`)、コード対応フレームが接続されていない場合、パネルには
  コード変更には Agent Native デスクトップまたは Builder が必要であることを説明するダイアログ;
  フレームが接続されると、リクエストはフレームとコードエージェントにルーティングされます
  インジケーターは、動作中は表示されます (`useSendToAgentChat`)。正規版
  コーディング ツール リストと共有 UI コントラクトについては、
  [Agent-Native Code UI](/docs/code-agents-ui).

```an-diagram title="コードリクエストゲート" summary="コード型メッセージには、コード対応フレームが必要です。 1 つが接続されている場合、リクエストはそこにルーティングされます。これがない場合、パネルはコード変更には Desktop または Builder が必要であると説明します。"
{
  "html": "<div class=\"diagram-gate\"><div class=\"diagram-node\" data-rough>message<br><small class=\"diagram-muted\">type: \\\"code\\\"</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\" data-rough>code-capable frame connected?</div><div class=\"diagram-col\"><div class=\"diagram-pill ok\">yes &rarr; route to frame, show code-agent indicator</div><div class=\"diagram-pill warn\">no &rarr; dialog: needs Desktop or Builder</div></div></div>",
  "css": ".diagram-gate{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-gate .diagram-col{display:flex;flex-direction:column;gap:8px}.diagram-gate .diagram-arrow{font-size:22px;line-height:1}.diagram-gate .center{text-align:center}"
}
```

「コード モード」はエージェント機能の切り替えであり、環境開発モードとは異なります
(`NODE_ENV` / Vite)。クライアントフックは`useCodeMode()`です。 (
後方互換エイリアスの [Compatibility notes](#compatibility))

ローカル開発フレームでは、設定歯車がこれらのモード間を切り替えます。切り替え
オフ コード モードでは、フレーム自体のサイドバーが非表示になり、アプリのアプリ内エージェントが表示されます
代わりに iframe 内のサイドバーを使用すると、エンド ユーザーに表示される内容を正確にプレビューできます。

## 統合ターミナルと CLI スイッチング {#cli-terminal}

開発中のパネルには埋め込み端末 (`AgentTerminal`、同様) が含まれています
from `@agent-native/core/client`) PTY サーバーによってバックアップされます。実際の
アプリのすぐ横に CLI をコーディングし、それらを切り替えます。端末が再起動します
選択した CLI と。

サポートされている CLI は、コア CLI レジストリから取得されます
(`packages/core/src/terminal/cli-registry.ts`)。以下のコマンドのみが許可されます
生成するため — PTY サーバーは、要求されたコマンドをレジストリと照合して検証します
インジェクションを防止する許可リスト:

| CLI            | コマンド   | パッケージをインストール    |
| -------------- | ---------- | --------------------------- |
| Claude コード  | `claude`   | `@anthropic-ai/claude-code` |
| Builder.io     | `builder`  | (内蔵)                      |
| Codex          | `codex`    | `@openai/codex`             |
| ジェミニ CLI   | `gemini`   | `@google/gemini-cli`        |
| オープンコード | `opencode` | `opencode-ai`               |

選択した CLI が `PATH` で見つからない場合、端末はフォールバックして実行します
`npx --yes <install-package>@latest` まで (インストール パッケージが存在する場合)。
デフォルトのコマンドは `claude` です。エージェント パネルの設定から CLI を任意の場所に切り替えます。
時間。

## Builder.io クラウド フレーム {#cloud-frame}

[Builder.io](https://www.builder.io) は、
クラウド内の同じアプリと同じエージェント パネル:

- リアルタイム コラボレーション - 複数のユーザーが同時に視聴し、対話できます。
- ビジュアル編集、役割、権限。
- 反復を高速化するための並列エージェント実行。
- 全員が 1 つのホスト環境を共有する、チームでの使用に適しています。

埋め込みパネルからのコード リクエストは、同様に Builder フレームにルーティングされます
それらはローカルの開発フレームにルーティングされるため、上記の開発対製品の動作は次のようになります
両方で一貫しています。

## ランタイム API {#runtime-apis}

これらは `@agent-native/core` に同梱されており、アプリが通信するために使用するものです
どのフレームがホストしているかに関係なく、エージェント:

1. **メッセージを送信** — `sendToAgentChat()` はエージェントにメッセージを送信します。
   `useSendToAgentChat()` フックは、説明されているコードリクエスト ゲートでラップします
   上で、レンダリングする `codeRequiredDialog` 要素を返します。
   完全な使用方法とオプションについては [Drop-in Agent](/docs/drop-in-agent)。
2. **生成状態** — `useAgentChatGenerating()` は、エージェントの状態を追跡します
   実行中であるため、UI はエージェントに直接ポーリングせずに進行状況を表示できます。
3. **ポーリング同期** — データベースに基づく同期により、エージェントの実行時に UI キャッシュが最新の状態に保たれます
   データまたはアプリケーションの状態を変更します。
4. **アクション システム** — `pnpm action <name>` は同じ呼び出し可能にディスパッチします
   エージェントは actions をツールとして呼び出すため、エージェントが実行できることはすべて実行できます
   スクリプト。

## 実行中 {#running}

埋め込みエージェント パネルはすべてのアプリの一部です。テンプレートを足場にして
すでにそこにあります:

```bash
npx @agent-native/core@latest create my-app --template mail --standalone
cd my-app
pnpm dev
```

ローカル開発フレーム (フレームワーク リポジトリ内のプライベート `@agent-native/frame` パッケージ) は、npm に公開されていない内部ツール パッケージです。アクティブなアプリの開発サーバーを iframe にロードし、その横に埋め込みパネルをマウントし、`app` クエリ パラメーターを介してアプリを選択します。統合された CLI 端末には、端末に必要なローカル コードと PTY アクセスを提供する Agent Native デスクトップが必要です。これがないと、パネルにチャット サーフェスが表示され、CLI を使用するためにデスクトップを開くように求められます。

## 互換性に関するメモ {#compatibility}

「コード モード」の概念は以前は「開発モード」と呼ばれていたため、いくつかの後方互換性があります
名は保持されます。古い統合を維持していない限り、これらは無視してかまいません。
コード:

- 基になる `AGENT_MODE` 環境変数、`/_agent-native/agent-chat/mode`
  エンドポイント (ペイロード キーは依然として `devMode`)、および `agent-chat.mode`
  設定キーは変更されません。
- `useDevMode()` は、`useCodeMode()` の非推奨のエイリアスとして残ります。
