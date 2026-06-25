---
title: "ビデオ"
description: "モーション グラフィックス、製品デモ、キネティック テキスト用のプログラマティック ビデオ スタジオ。プロンプトからアニメーションを生成し、タイムライン上で調整します。"
---

# ビデオ

手動でキーフレームを作成するのが面倒なモーション グラフィックス、製品デモ、キネティック テキスト ビデオなどを作成するためのプログラマティック ビデオ スタジオ。エージェントに「2 秒でフェードインする 6 秒間のロゴ表示」を依頼すると、アニメーションが構築されます。タイムライン上でタイミング、イージング、カメラの動きを調整し、MP4 または WebM にレンダリングします。

```an-wireframe
{
  "surface": "desktop",
  "html": "<div style='display:flex;flex-direction:column;gap:12px;padding:16px;min-height:530px;box-sizing:border-box'><div style='display:flex;align-items:center;gap:10px'><h1 style='margin:0'>ロゴ表示</h1><span class='wf-pill accent'>6 seconds</span><div style='flex:1'></div><button>Preview</button><button class='primary'>Render</button></div><div class='wf-card' style='flex:1;display:flex;align-items:center;justify-content:center;min-height:250px'><div style='text-align:center'><strong>Remotion プレビュー</strong><br/><small class='wf-muted'>logo scales in as the title fades</small></div></div><div class='wf-card' style='display:flex;flex-direction:column;gap:10px'><div style='display:flex;gap:8px;align-items:center'><span class='wf-pill'>0s</span><span class='wf-pill'>2s</span><span class='wf-pill'>4s</span><span class='wf-pill'>6s</span><div style='flex:1'></div><button>新しいトラック</button></div><div class='wf-box'>タイトルのフェード · 0-48フレーム</div><div class='wf-box'>ロゴ拡大 · 48-120フレーム</div><div class='wf-box'>カメラプッシュ · 72-144フレーム</div></div></div>"
}
```

スタジオを開くと、ホーム画面にコンポジションのリストが表示されます。いずれかをクリックすると、上部にプレーヤー、下部にタイムライン、右側にプロパティ パネルが表示されます。エージェントは、ユーザーがどのコンポジションを開いているかを常に知っています。

```an-diagram title="データとしてのアニメーション" summary="コンポジションは React コンポーネントです。すべてのアニメーションはトラックから読み込まれるため、エージェントとタイムラインは同じデータを編集します。"
{
  "html": "<div class=\"diagram-flow\"><div class=\"diagram-col\"><div class=\"diagram-node\">Timeline<br><small class=\"diagram-muted\">ドラッグ、リサイズ、スクラブ</small></div><div class=\"diagram-node\">Agent<br><small class=\"diagram-muted\">\"fade in at 2s\"</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\"><span class=\"diagram-pill accent\">AnimationTrack</span><small class=\"diagram-muted\">startFrame / easing / animatedProps</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough>Reactコンポジション<br><small class=\"diagram-muted\">Remotion &lt;Player&gt;</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\">MP4 / WebM</div></div>",
  "css": ".diagram-flow{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-flow .diagram-col{display:flex;flex-direction:column;gap:10px}.diagram-flow .center{display:flex;flex-direction:column;align-items:center;gap:4px}.diagram-flow .diagram-arrow{font-size:22px;line-height:1}"
}
```

## それを使って何ができるか

- **プロンプトからアニメーションを生成します。** 「2 秒でフェードインし、5 秒まで保持されるタイトル カードを追加します。」エージェントがコンポジションを編集します。
- **タイムラインでタイミングを調整します。** アニメーション トラックをドラッグしてサイズ変更し、フレームをスクラブし、イージング カーブを視覚的に設定します。
- **カメラをアニメーション化します。** 画面上のツールを使用してパン、ズーム、チルトします。ツールをクリックし、プレビュー内でドラッグすると、キーフレームが自動作成されます。
- **空の構成またはサンプルから開始します。** テンプレートには、開始する 1 つのコード内構成 (`BlankComposition`) が同梱されています。サンプル構成 — キネティック テキスト、ロゴの表示、パーティクル バースト、インタラクティブな UI デモ、スライドショー — はデータベースからロードされ、独自のものを追加できます。
- **イージング カーブを視覚的に編集します。** パワー、バック、バウンス、サーキュレーション、エラスティック、エキスポ、サイン、スプリング物理など、30 以上のカーブが同梱されています。
- **1x、2x、または 3x スーパーサンプリングで MP4 または WebM** にレンダリングし、カメラのズーム中に鮮明なテキストとベクトルを実現します。

これは、他のテンプレートよりも開発者向けのツールです。コンポジションは React コンポーネントであるため、パワー ユーザー (またはエージェント) はまったく新しいアニメーション タイプを最初から作成できます。しかし、日常的な微調整 (「タイピングを遅くする」、「パーティクルの数を 12 に減らす」) は単なる雑談です。

## はじめに

ライブデモ: [videos.agent-native.com](https://videos.agent-native.com)。

スタジオを開くとき:

1. ホーム画面からコンポジションを選択します。
2. エージェントを試してください:「2 秒でフェードインするロゴの表示を追加します。」タイムラインの更新を確認してください。
3. トラックをドラッグしてリタイムし、カメラ ツールをクリックし、プレーヤーをスクラブします。

### 便利なプロンプト

- 「2 秒でフェードインし、5 秒まで保持されるタイトル カードを追加します。」
- 「フレーム 60 と 90 の間でロゴを 2 倍にズームするようにカメラを変更します。」
- 「入力の表示を遅くします - 40% 長くします。」
- 「パーティクルのバーストが濃すぎます。カウントを 12 に下げてください。」
- 「イントロループ、1080x1080、6 秒という名前の新しいコンポジションを作成します。」
- 「ボタン ゾーンにクリック アニメーションを追加し、そこにカーソルをアニメーション化します。」
- 「このトラックにイーズアウトではなくスプリングイージングを与えます。」

タイムラインでトラックを選択して Cmd+I を押すと、エージェントはその選択を選択します。「これをもっときびきびさせてください」というだけで機能します。

## 開発者向け

このドキュメントの残りの部分は、ビデオ テンプレートをフォークしたり拡張したりする人を対象としています。このテンプレートは他のテンプレートよりもコードフォワードです。すべてのコンポジションは React コンポーネントであり、すべてのアニメーションはトラック上のデータです。

### アーキテクチャ

スタジオで目にするものはすべてコードです。コンポジションは、`app/remotion/compositions/` の React コンポーネントを指す `app/remotion/registry.ts` の `CompositionEntry` です。そのコンポーネント内のすべてのアニメーションは `AnimationTrack` から読み取られるため、ユーザーはタイムライン UI でドラッグ、サイズ変更、リタイムを行うことができます。エージェントは、新しいコンポジションの作成、トラックの追加、イージングの調整、レジストリにプラグインする React コンポーネント全体の書き込みを行うことができます。

スタジオは、プレビュー用に Remotion の `<Player>` で実行され、最終レンダリング用に Remotion CLI で実行されます。出力のデフォルトは 1920x1080、30fps です。

### クイックスタート

CLI から新しいビデオ アプリをスキャフォールディングします:

```bash
npx @agent-native/core@latest create my-video-app --standalone --template videos
cd my-video-app
pnpm install
pnpm dev
```

ブラウザでスタジオを開き、コンポジションを作成し、白紙の状態から始めます。エージェントに「2 秒でフェードインするロゴを追加してください」などと依頼すると、構成を編集してくれます。

### 主な機能

**React ベースのコンポジション。** ビデオは、SQL ベースのユーザー コンポジションと、ローカル デフォルト用のオプションのコード レジストリを備えた、Remotion ベースの React コンポーネントです。

**タイムラインファーストのアニメーション。** デュレーション トラック、キーフレーム、イージング カーブ、カメラの動き、およびプログラムによるエクスプレッション トラックはすべて、同じコンポジション データを編集します。

**調整可能なモーション システム。** パラメータ、カーソル トラック、インタラクティブ ホバー ゾーン、範囲ナビゲーション、および繰り返し再生により、コードなしで生成されたアニメーションを調整できます。

**レンダリングと永続性。** コンポジション設定、品質、fps、トラック値、およびオーバーライドはコンポジションごとに保持され、リモートを通じて MP4 または WebM にレンダリングされます。

### エージェントとの連携

エージェントは、あなたがどのコンポジションを開いているかを常に知っています。ナビゲーション状態 (`{ view, compositionId }`) はフレームワークの `application_state` テーブルに書き込まれ、`view-screen` アクションはそれと `app/remotion/registry.ts` を指すヒントを返します。どの構成を使用しているかをエージェントに伝える必要はありません。「これ」に基づいて動作するようにエージェントに依頼すれば、動作します。

内部では、エージェントは `navigate`、`save-composition`、`generate-animated-component` のように actions を呼び出します。 SQL でバックアップされた構成レコードは、`save-composition` を通じて作成または更新されます。コードバックされた Remotion コンポーネントは依然として `app/remotion/compositions/*.tsx` に存在し、`app/remotion/registry.ts` に登録されます。

### データモデル

サーバー側のスキーマは `templates/videos/server/db/schema.ts` にあります:

```an-schema title="ビデオデータモデル" summary="SQL でサポートされたコンポジションに加え、デザイン システムとネスト可能なフォルダーがあり、それぞれにフレームワーク共有テーブルが含まれます。"
{
  "entities": [
    {
      "id": "compositions",
      "name": "compositions",
      "note": "User-created compositions and overrides; ownableColumns",
      "fields": [
        { "name": "id", "type": "text", "pk": true },
        { "name": "title", "type": "text" },
        { "name": "type", "type": "text" },
        { "name": "data", "type": "text", "note": "完全な構成 JSON ブロブ" },
        { "name": "created_at", "type": "text" },
        { "name": "updated_at", "type": "text" }
      ]
    },
    {
      "id": "design_systems",
      "name": "design_systems",
      "note": "Reusable brand tokens; ownableColumns",
      "fields": [
        { "name": "data", "type": "text", "note": "colors / typography / spacing" },
        { "name": "assets", "type": "text", "nullable": true },
        { "name": "custom_instructions", "type": "text", "nullable": true },
        { "name": "is_default", "type": "boolean" }
      ]
    },
    {
      "id": "folders",
      "name": "folders",
      "note": "Nestable folders; ownableColumns",
      "fields": [
        { "name": "id", "type": "text", "pk": true },
        { "name": "name", "type": "text" }
      ]
    },
    {
      "id": "folder_memberships",
      "name": "folder_memberships",
      "note": "多対多の参加",
      "fields": [
        { "name": "folder_id", "type": "text", "fk": "folders.id" },
        { "name": "composition_id", "type": "text", "fk": "compositions.id" }
      ]
    }
  ],
  "relations": [
    { "from": "folders", "to": "folder_memberships", "kind": "1-n", "label": "members" },
    { "from": "compositions", "to": "folder_memberships", "kind": "1-n", "label": "in folders" }
  ]
}
```

各テーブルには、`createSharesTable()` によって生成された、一致するフレームワーク共有テーブル (`composition_shares`、`design_system_shares`、`folder_shares`) もあります。

- `compositions` — ID、タイトル、タイプ、`data` (完全な構成 JSON BLOB)、所有権列、タイムスタンプ。
- `composition_shares` — `createSharesTable()` によって作成された標準株式付与。
- `design_systems` — `ownableColumns` を使用した再利用可能なブランド トークン (色、タイポグラフィ、間隔、アセット、カスタム指示、`is_default` フラグ)。
- `design_system_shares` — デザイン システムに対する助成金を共有します。
- `folders` — `ownableColumns` を使用した、ライブラリ整理用のネスト可能なフォルダー。
- `folder_shares` — フォルダーの共有許可。
- `folder_memberships` — `folder_id` と `composition_id` 間の多対多結合。

### フォルダとデザイン システム

コンポジションはフォルダーに整理し、デザイン システムでスタイルを設定できます。 Actions: `create-folder`、`rename-folder`、`delete-folder`、`move-composition-to-folder`。デザインシステム actions: `create-design-system`、`update-design-system`、`get-design-system`、`list-design-systems`、`set-default-design-system`、`apply-design-system`、`analyze-brand-assets`。 actions をインポート: `import-github`、`import-from-url`、`import-document` (DOCX/PPTX/PDF)。

`app/remotion/registry.ts` のレジストリは、テンプレートに同梱されるコード内の信頼できるソースです。 SQL テーブルには、ユーザーが作成したコンポジションとオーバーライドが保存されます。スタジオの状態 (コンポジションごとのトラック編集、プロップのオーバーライド、コンポジション設定) は、`videos-tracks:<id>`、`videos-props:<id>`、`videos-comp-settings:<id>` の下の `localStorage` にミラーリングされ、ロード時にレジストリのデフォルトにディープマージされて戻されます。

コア TypeScript シェイプ (`app/types.ts`):

- `AnimationTrack` — `id`, `label`, `startFrame`, `endFrame`, `easing`, `animatedProps[]`.
- `AnimatedProp` — `property`、`from`、`to`、`unit`、およびオプションの `keyframes`、`programmatic`、`description`、`codeSnippet`、`parameters`、`parameterValues`。
- `CompositionEntry` — `id`, `title`, `description`, `component`, `durationInFrames`, `fps`, `width`, `height`, `defaultProps`, `tracks`.

デフォルトでは、コンポジションは非公開です。可視性は `private`、`org`、または `public` で、共有許可により `viewer`、`editor`、または `admin` ロールが付与されます。これは、フレームワークの共有プリミティブを通じて関連付けられます。

### カスタマイズ

テンプレート フォルダーは `templates/videos/` です (ユーザー側のスラッグは `video` ですが、フォルダーは複数形です)。

**Actions** — `templates/videos/actions/`

- `view-screen.ts` — エージェントの現在のナビゲーション状態を返します。
- `navigate.ts` — コンポジション (`--compositionId <id>`) またはホーム ビュー (`--view home`) に移動します。
- `save-composition.ts` — SQL に裏付けされた構成レコードを作成または更新します。
- `generate-animated-component.ts` — ボイラープレートを含む新しい Remotion コンポーネント ファイルを生成します。
- `validate-compositions.ts` — 登録されているすべての組成物に構造的な問題がないか確認します。
- `list-compositions.ts`、`get-composition.ts`、`update-composition.ts`、`delete-composition.ts` — SQL をサポートする構成レコードの読み取り、更新、削除。

**ルート** — `templates/videos/app/routes/`

- `_index.tsx` — スタジオ ホーム;シェルと構成リストをレンダリングします。
- `c.$compositionId.tsx` — コンポジションエディター (タイムライン、プレーヤー、プロパティパネル)。
- `components.tsx` — コンポーネント ライブラリ ブラウザ。
- `team.tsx` — チーム管理。

**リモート内部構造** — `templates/videos/app/remotion/`

- `registry.ts` — 権威ある構成リスト。
- `compositions/` — 構成ごとに 1 つの `.tsx` と `index.ts` バレル。
- `trackAnimation.ts` — `trackProgress`, `getPropValue`, `findTrack`, `getPropValueKeyframed`.
- `CameraHost.tsx` — コンポジション コンテンツをカメラ変換でラップします。
- `hooks/`、`ui-components/`、`components/` — インタラクティブ要素ヘルパー、カーソル レンダリング、アニメーション要素ラッパー。

**スタジオ UI** — `templates/videos/app/components/`

- `Timeline.tsx` — 完全に制御されたタイムライン (`viewStart` / `viewEnd` は内部的に状態を所有しません)。
- `VideoPlayer.tsx` — 範囲制限付き再生を備えたリモート `<Player>` ラッパー。
- `TrackPropertiesPanel.tsx`、`CompSettingsEditor.tsx`、`PropsEditor.tsx` — 右側のパネル。
- `CameraToolbar.tsx`、`CameraControls.tsx` — カメラ ツールと数値コントロール。

**エージェントの指示** — `templates/videos/AGENTS.md` は、エージェントが読む長い形式のガイドです。トラックとしてのアニメーション ルール、カメラ システム、カーソル システム、CSS フィルター ユニット、インタラクティブ コンポーネントの登録、UI 間隔、コンポジションの作成または編集のためのチェックリストについて説明します。

**Skills** — `templates/videos/.agents/skills/`

- `composition-management/SKILL.md` — コンポジションを作成して登録する方法。
- `animation-tracks/SKILL.md` — トラックとアニメーション プロップを編集する方法。
- さらに、標準フレームワーク skills: `actions`、`self-modifying-code`、`delegate-to-agent`、`storing-data`、`security`、`frontend-design`、`create-skill`、`capture-learnings`。

新しいコンポジションを追加するには、`AGENTS.md` のチェックリストに従ってください。コンポーネントを作成し、`FALLBACK_TRACKS` を宣言し、`findTrack` / `trackProgress` / `getPropValue` を使用し (フレームをハードコードしないでください)、`compositions/index.ts` からエクスポートし、`CompositionEntry` をレジストリに追加し、`pnpm typecheck` を実行します。
