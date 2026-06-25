---
title: "ワークスペースのガバナンス"
description: "分岐、CODEOWNERS、PR レビュー、Dispatch が git レベルのガバナンスと並行してランタイム ガバナンスを処理する方法。"
---

# ワークスペースのガバナンス

> **どのワークスペース ドキュメントですか?** このページでは **ガバナンス**、つまり 1 つのリポジトリ内の多くのアプリにわたって誰が何をレビュー、承認、所有するのかについて説明します。ワークスペース (カスタマイズ層) とは何かについては、[Workspace](/docs/workspace) を参照してください。デプロイメントの形状 (1 つのモノリポジトリ、多数のアプリ) については、[Multi-App Workspaces](/docs/multi-app-workspace) を参照してください。

このガイドでは、エージェント ネイティブ ワークスペースの実行の運用面、つまり分岐方法、誰が何をレビューするか、コード所有権の設定方法、ディスパッチ コントロール プレーンをガバナンス モデルにどのように適合させるかについて説明します。

```an-diagram title="2 つのガバナンス プレーン" summary="Git はコードを管理します。 Dispatch は実行時間を管理します。これらは補完的であり、一方の内部で他方を複製しないでください。"
{
  "html": "<div class=\"gov\"><div class=\"diagram-card\"><span class=\"diagram-pill accent\">Git と GitHub</span><strong>コードガバナンス</strong><div class=\"gov-list\"><span class=\"diagram-pill\">CODEOWNERS</span><span class=\"diagram-pill\">branch protection</span><span class=\"diagram-pill\">PR レビュー</span><span class=\"diagram-pill\">git log / blame</span></div></div><div class=\"diagram-pill diagram-muted\">+</div><div class=\"diagram-card\"><span class=\"diagram-pill accent\">Dispatch</span><strong>Runtime governance</strong><div class=\"gov-list\"><span class=\"diagram-pill\">vault secrets &amp; grants</span><span class=\"diagram-pill\">workspace resources</span><span class=\"diagram-pill\">agent profiles</span><span class=\"diagram-pill\">approvals &amp; audit</span></div></div></div>",
  "css": ".gov{display:flex;align-items:center;gap:16px;flex-wrap:wrap}.gov .diagram-card{display:flex;flex-direction:column;gap:8px;padding:16px 18px;flex:1;min-width:240px}.gov .gov-list{display:flex;flex-wrap:wrap;gap:6px;margin-top:4px}"
}
```

## 分岐

### 機能ブランチ

すべての作業に有効期間の短い機能ブランチを使用します:

```
main                         ← production
├── feat/mail-filters        ← single-app change
├── feat/core-oauth-refresh  ← framework change
├── fix/analytics-chart      ← targeted bug fix
└── feat/vault-encryption    ← dispatch/infra change
```

**命名規則:**

- **単一アプリの変更:** `feat/<app>-<description>` または `fix/<app>-<description>` — 例: `feat/mail-thread-search`、`fix/calendar-recurrence-parse`
- **フレームワークの変更:** `feat/core-<description>` または `fix/core-<description>` — 例: `feat/core-polling-v2`
- **ディスパッチの変更:** `feat/dispatch-<description>` — 例: `feat/dispatch-vault-policies`
- **クロスアプリの変更:** フレームワークの変更でテンプレートの更新が必要な場合は、両方を 1 つのブランチで実行して、アトミックに出荷します

ブランチの寿命を短くしてください。存続期間の長いブランチはメインから分岐し、特に複数のチームが毎日プッシュするモノリポジトリでは、苦痛を伴うマージが発生します。

### 非開発者ブランチ

変更を加える必要がある人全員が git に慣れているわけではありません。 [Builder.io](https://www.builder.io) は、内部で git ブランチにマップするビジュアル ブランチ モデルをサポートしています。これは、コンテンツとコピーの変更、レイアウト調整、設計の反復、開発環境を使用しない A/B テストに役立ちます。

## コードの所有権

コード ガバナンスは、リポジトリ ルートにあるいくつかのファイルによって構成されます。

```an-file-tree title="repo 内のガバナンス設定"
{
  "entries": [
    { "path": ".github/CODEOWNERS", "note": "変更パスごとに reviewers を自動割り当て" },
    { "path": ".github/labeler.yml", "note": "app ごとに PR へ自動ラベル付け" },
    { "path": "pnpm-workspace.yaml", "note": "Workspace レベル: 広範な review" },
    { "path": "package.json", "note": "Workspace レベル: platform team が所有" }
  ]
}
```

GitHub の CODEOWNERS ファイルは、変更されたファイルに基づいてレビュー担当者を PR に自動的に割り当てます。リポジトリのルートに `.github/CODEOWNERS` を作成します。

```
# Framework core — affects every app; platform team reviews all changes
packages/core/                     @your-org/platform-team

# コントロール プレーンのディスパッチ — シークレット、統合、ワークスペース リソース
templates/dispatch/                @your-org/platform-team

# アプリごとの所有権 - 各チームが自分のアプリをレビューします
templates/mail/                    @your-org/mail-team
templates/analytics/               @your-org/analytics-team
templates/calendar/                @your-org/calendar-team
# ... add an entry per app

# ワークスペースレベルの構成 - すべての人に影響するため、広範なレビューを行う
.github/                           @your-org/platform-team
package.json                       @your-org/platform-team
pnpm-workspace.yaml                @your-org/platform-team
```

重要なヒント: 個人ではなく、GitHub チーム (`@org/team`) を使用してください。フレームワークとディスパッチの変更には、常にプラットフォームのレビューが必要です。 glob 構文と複数所有者のパターンについては、[GitHub CODEOWNERS docs](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners) を参照してください。

必要なレビューを有効にするには: [設定] → [ブランチ] → [`main` のブランチ保護] → **マージ前にプルリクエストが必要** → **コード所有者からのレビューが必要**。

## PR ラベル

`.github/labeler.yml` を使用したアプリごとの自動ラベル付け (抜粋):

```yaml
app:mail:
  - changed-files:
      - any-glob-to-any-file: templates/mail/**
app:analytics:
  - changed-files:
      - any-glob-to-any-file: templates/analytics/**
core:
  - changed-files:
      - any-glob-to-any-file: packages/core/**
```

次に、[actions/labeler](https://github.com/actions/labeler) アクションを追加します。完全なワークフロー YAML については、そのリポジトリの README を参照してください。 PR が開かれるか更新されると、ラベルは自動的に適用されます。

## PR レビューのガイドライン

| タイプを変更                          | レビューする人                                           | 注意すべき点                                                                                 |
| ------------------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **アプリのみ** (`templates/<app>/`)   | アプリ チームを所有する                                  | ドメインの正確性、アクションスキーマ                                                         |
| **フレームワーク** (`packages/core/`) | プラットフォーム チーム + 影響を受けるアプリ チーム 1 つ | 重大な変更、パフォーマンス、下位互換性                                                       |
| **スキーマの移行**                    | プラットフォーム チーム + シニア エンジニア              | データの安全性、方言非依存性 (SQLite + Postgres)                                             |
| **Actions**                           | 所有チーム                                               | Actions はどちらもエージェント ツール AND HTTP エンドポイントです — 両方の角度から確認します |
| **クロスアプリ A2A**                  | 両方のアプリ チーム                                      | A2A インターフェイスを変更する場合、呼び出し元はそれを知る必要があります                     |
| **ボールト/リソースを派遣します**     | プラットフォーム チーム                                  | 秘密のアクセス、付与範囲、誰が何を取得するか                                                 |

### エージェントの同時作業

エージェント ネイティブ ワークスペースでは、多くの場合、複数の AI エージェントが同じブランチで同時に動作します。これは仕様によるものです。エージェントはブランチを共有し、個別にプッシュします。

```an-callout
{ "tone": "warning", "body": "**The later commit wins.** Two agents touching the same file won't conflict at commit time — the conflict surfaces at review. Run `pnpm run prep` (typecheck + test + format) before pushing, and don't revert changes you didn't make unless they're clearly broken." }
```

この環境で PR を確認する場合:

- **明らかに壊れている場合を除き、加えなかった変更を元に戻さないでください**
- **同じ PR 内の複数のエージェントによってファイルが変更される可能性があります** - これは正常です
- **エージェントの変更間の統合の問題をキャッチするためにプッシュする前に、`pnpm run prep`** (typecheck + test + format) を実行してください
- **2 人のエージェントが同じファイルにアクセスした場合、** 後のコミットが優先されます。競合はコミット時ではなくレビュー時に表面化します
- **どのエージェントがコードを作成したかに関係なく、PR 内のコードのバグを修正します**。 PR は全体的にレビューされます。

## 統治者として派遣

[Dispatch](/docs/dispatch) アプリは、ワークスペースのランタイム コントロール プレーンです。これは、Git レベルのガバナンスをランタイム ガバナンスで補完します。

| 懸念                         | Git と GitHub           | 派遣                                                         |
| ---------------------------- | ----------------------- | ------------------------------------------------------------ |
| コードを変更できる人         | CODEOWNERS、分岐保護    | —                                                            |
| 秘密にアクセスできる人       | —                       | Vault ポリシー、許可、リクエストのワークフロー               |
| エージェントが従う指示       | —                       | グローバル ワークスペース リソース (AGENTS.md、手順、skills) |
| 共有されるエージェント       | —                       | ワークスペース エージェント プロファイル                     |
| 統合インベントリ             | —                       | ワークスペースの接続と統合のカタログ                         |
| 実行時変更の承認             | —                       | 派遣承認フロー                                               |
| 監査証跡                     | `git log` / `git blame` | ボールト監査 + ディスパッチ監査ログ                          |
| メッセージングとルーティング | —                       | Slack / 電報統合                                             |

**Git はコード ガバナンスを処理します。 Dispatch はランタイム ガバナンスを処理します。** Dispatch 内で git ワークフローを複製したり、その逆を試みたりしないでください。

Dispatch は、ボールト シークレット、再利用可能なワークスペース接続、ワークスペース リソース (skills、手順、エージェント プロファイル、MCP サーバー)、承認、および監査ログを管理します。パブリックアプリのルート構成 (`workspaceApp.audience` / `publicPaths` / `protectedPaths`) については、[Multi-App Workspaces — Public app routes](/docs/multi-app-workspace#deployment) を参照してください。

リソース モデルと正規パスについては、[Workspace — Global resources](/docs/workspace#global-resources) を参照してください。

## セットアップチェックリスト

新しいワークスペースの場合、`npx @agent-native/core@latest create` を実行した後:

**Git と GitHub:**

- [ ] アプリごとのチーム所有権を持つ `.github/CODEOWNERS` を作成します
- [ ] コード所有者のレビューが必要な `main` でブランチ保護を有効にします
- [ ] アプリごとに PR を自動ラベル付けするために `.github/labeler.yml` を追加
- [ ] 各アプリとプラットフォーム チームに GitHub チームを作成します

**発送:**

- [ ] 共有シークレットをボールトに追加します (API キー、OAuth 認証情報など)
- [ ] デフォルトの all-apps Vault ポリシーを維持するか、手動のアプリごとの許可に切り替える
- [ ] ボールト シークレットを同期してアプリにプッシュします
- [ ] 共有プロバイダー アカウントの再利用可能なワークスペース接続を登録してから
      Brain、Analytics、Mail、Dispatch などのアプリを必要な場合にのみ許可します
      そのアカウント
- [ ] [リソース] ページを介して、ワークスペース全体の skills、ガードレール手順、およびブランド/会社参照リソースを追加します。完全なリソース モデル テーブルと推奨スターター パックについては、[Workspace](/docs/workspace#global-resources) を参照してください。
- [ ] 承認ポリシーと承認者の電子メールを設定する
- [ ] 管理者通知用に SendGrid (`SENDGRID_API_KEY`、`SENDGRID_FROM_EMAIL`) を設定します
- [ ] ワークスペース メッセージングのために Slack または Telegram に接続します
- [ ] 共有 MCP サーバーを構成します — すべてのアプリまたは選択されたアプリの許可のためにディスパッチに `mcp-servers/<name>.json` ワークスペース リソースを追加します。下位レベルの展開には `mcp.config.json` または [MCP hub mode](/docs/mcp-clients#hub) を使用します
