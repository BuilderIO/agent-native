---
title: "耐久性のある履歴書"
description: "ホスト型エージェントの実行が中断されて再開される場合、完了した副作用のあるツール呼び出しは再実行されません。耐久性台帳から派生したツール呼び出しジャーナルにより、重複した送信、請求、チケットがブロックされます。"
---

# 耐久性のある履歴書

> **対象者:** フレームワークがどのように実行されるかを理解したい人
> リカバリにより、重複した副作用が回避されます。これは組み込みの動作です。
> 接続するものは何もありません。

ホストされたエージェントの実行が中断されます。サーバーレス関数がストリームの途中でハード タイムアウトに達し、ゲートウェイが 45 秒で接続を切断し、ソケットがハングアップし、プラットフォームがコールドスタートします。フレームワークは、会話プレフィックスを保存し、LLM 呼び出しを再実行する (「中断したところから続行する」) ことで、これらの状況からすでに回復しています。しかし、回復だけでも鋭い利点があります。中断された試行が **すでにメールを送信しているか、チケットを作成している**場合、単純な履歴書で再度実行できる可能性があります。

耐久性のある履歴書がそのギャップを埋めます。再開時に、フレームワークは、どの副作用ツール呼び出しがすでに完了しているかを認識し、それらの再実行を拒否します (2 つのレイヤーで)。

```an-diagram title="2 つのレイヤーが再開時の重複した副作用をブロックします" summary="ジャーナルは耐久性台帳を読み取り、以前の通話を分類します。レイヤ 1 はモデルに指示し、レイヤ 2 は完了したエントリに一致する再ディスパッチされた書き込みをハードブロックします。"
{
  "html": "<div class=\"diagram-durable\"><div class=\"diagram-box\" data-rough>Run-event ledger<br><small class=\"diagram-muted\">tool_start / tool_done</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\" data-rough><strong>Tool-call journal</strong><small class=\"diagram-ok\">completed = start+done</small><small class=\"diagram-warn\">interrupted = start, no done</small></div><div class=\"diagram-col\"><div class=\"diagram-pill\">Layer 1 · prompt note &rarr; model</div><div class=\"diagram-pill accent\">レイヤー2 · ハードブロックされた再ディスパッチ書き込み</div></div></div>",
  "css": ".diagram-durable{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.diagram-durable .diagram-col{display:flex;flex-direction:column;gap:8px}.diagram-durable .diagram-arrow{font-size:22px;line-height:1}.diagram-durable .center{display:flex;flex-direction:column;align-items:center;gap:4px}"
}
```

## ツールコールジャーナル {#journal}

ジャーナルは **耐久性のある実行イベント台帳の純粋な読み取り**です。ホット パスには新しい記録フックはありません。現在のターンですでに記録されているツール呼び出しを分類します。

- **Completed** — `tool_start` と一致する `tool_done`。呼び出しが実行され、副作用が発生し、その結果が記録されました。 **再実行しないでください。**
- **中断** — `tool_done` に一致するものが**ない** `tool_start`。電話が始まり、その副作用が現れたかもしれないし、そうでないかもしれない、そして中断が結果を蝕んだ。結果は不明。

マッチングは、耐久性のあるターンが他の場所でどのように再構築されるかを反映しています。`tool_done` は、同じツール名 (ツールごとに FIFO) のまだ開いている最も古い `tool_start` とペアになります。 `clear` イベント (破棄されたパーシャル出力) はターンごとの集計をリセットするため、破棄されたパーシャルがファントム オープン コールを残さないようにします。

## レイヤー 1: プロンプトレベルのジャーナルノート {#prompt-note}

実行が再開されると (ソフト タイムアウト、ゲートウェイ タイムアウト、または再開可能なトランスポート エラー)、フレームワークは、「中断したところから続行する」ナッジの直後に、**構造化されたジャーナル メモ**を再開プロンプトに追加します。このメモはモデルにプレーン テキストで次のように伝えます。

- このツールは **すでに完了** (結果は短い) を呼び出すため、それらを再利用し、**再実行しません**。
- どのツール呼び出しが **不明な結果で中断された**ため、成功か失敗かを判断する前に状態を確認します。

ジャーナルが空の場合 (ツール アクティビティのないターン、またはクリーンな継続)、余分なものは何も追加されず、再開動作はバイトごとに以前と同じになります。このメモはベストエフォート型です。失敗した台帳の読み取りによって、通常は成功するリカバリがブロックされることはありません。

## レイヤー 2: ツールレイヤーのハードブロック {#hard-block}

プロンプトメモはアドバイスです。行儀の良いモデルは注意を払いますが、モデルは保証ではありません。したがって、ループはツール層でもそれを強制します。

再開されたチャンクでループが実行される前に、ジャーナルのスナップショットが 1 回作成されます (この論理ターンの **前の** チャンクのみをキャプチャします)。モデルが、ツール名 ** と input** が完了したジャーナル エントリと一致する **write** ツールを再ディスパッチすると、ループが短絡します。アクションを実行する代わりに、ジャーナルに記録された結果を返します。ただし、呼び出しは以前に中断された試行ですでに完了しており、重複した副作用を避けるために再実行されなかったことが注意されます。

主要なプロパティ:

- **書き込みツールのみ。** 読み取り専用 (`readOnly` / GET) actions はブロックされません。再読み取りは安全で冪等です。
- **Content-addressed.** 一致はツール名 + 入力署名であるため、ターン内の別の位置にある再開された呼び出しは依然として一致します。 *異なる*呼び出し (異なる引数) は新しいものとして扱われ、通常どおり実行されます。
- **Consume-once.** 完了した各エントリは一致すると要求されるため、同じターン内の 2 つの完全に異なる同一のフレッシュ コールが両方とも 1 つのジャーナリングされた完了でショートすることはありません。
- **新鮮なコールはそのままです。** 最初のターンのコールでは空のジャーナルが表示されます。通常の実行では何も変わりません。

```an-callout
{
  "tone": "success",
  "body": "Together the two layers mean an interrupted run that already had a real side effect resumes **without repeating it** — no duplicate emails, charges, or tickets — while genuinely new work still runs. Read-only actions are never blocked; re-reading is always safe."
}
```

## 関連

- [**Real-Time Sync**](/docs/real-time-collaboration) — 耐久性のある実行台帳がクライアントにストリーミングされ、再接続時に再生される方法。
- [**Actions**](/docs/actions) — `readOnly` は、読み取りを再実行しても安全であるとマークします。それ以外のものはすべて副作用として扱われます。
- [**In-Loop Processors**](/docs/processors) — 別のループ内部硬化シーム。
