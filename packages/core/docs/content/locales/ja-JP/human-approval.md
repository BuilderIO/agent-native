---
title: "人間参加型の承認"
description: "重要なアクションが実行される前にエージェントを一時停止します。defineAction の needApproval ゲートは、approval_required イベントを発行し、人間が承認して初めてツールが実行されます。"
---

# 人間参加型の承認

ほとんどの actions はそのまま実行できるはずです。メールの送信、カードへのチャージ、アカウントの削除などのいくつかの操作は、外向きで元に戻すのが難しいため、エージェントに自律的に実行してほしくありません。これらの場合、`defineAction` にはオプトイン **承認ゲート** があります。エージェントがアクションを呼び出そうとすると、ループが一時停止し、承認/拒否アフォーダンスを人間に表示し、人間がその特定の呼び出しを承認した後でのみアクションを実行します。

> [!WARNING]
> 承認は稀に保ちます。すべてのゲート アクションはエージェント ループのハード ストップであり、実行が中断され、人間による往復が必要になります。 `needsApproval` は、本当に重大な結果をもたらす、元に戻すのが難しい、外向きの操作にのみ使用してください。読み取りまたは定期的な書き込みをゲートしていることに気付いた場合、それは間違っています。デフォルトは **オフ** であり、ほとんどすべてのアクションではオフのままにする必要があります。

## `needsApproval` ゲート {#needs-approval}

`defineAction` に `needsApproval` を設定します。ブール値または述語を受け入れます。

```an-annotated-code title="1 つの結果的なアクションをゲートする"
{
  "filename": "actions/send-email.ts",
  "language": "ts",
  "code": "export default defineAction({\n  description: \"Send an email via Gmail.\",\n  schema: z.object({\n    to: z.string(),\n    subject: z.string(),\n    body: z.string(),\n  }),\n  // Sending is outward-facing and hard to undo, so the agent can never send\n  // without a human approving the specific call. Drafting/queueing is\n  // unaffected — only the real send is gated.\n  needsApproval: true,\n  run: async (args) => {\n    /* ...actually send... */\n  },\n});",
  "annotations": [
    { "lines": "10", "label": "門全体", "note": "フラグは 1 つです。それが真実であり、呼び出しが承認されていない場合、ループは `run` の前で停止します。つまり、モデル自体が副作用に到達することはありません。" },
    { "lines": "11-13", "label": "run() is untouched", "note": "ハンドラーはそのままです。承認は、`run` 内の何かによってではなく、周囲のループによって強制されます。" }
  ]
}
```

- **`needsApproval: true`** — 常に承認が必要です。
- **`needsApproval: (args, ctx) => boolean | Promise<boolean>`** — 述語が true を返した場合にのみ承認が必要です。条件付きでゲートします。例:外部受信者のみ、またはしきい値を超える金額のみ:

  ```ts
  needsApproval: (args) => !args.to.endsWith("@your-company.com"),
  ```

  述語を純粋かつ高速に保ちます。 **失敗クローズ**: 述語がスローされた場合、フレームワークは結果の高いアクションを黙って実行するのではなく、それを「承認が必要」として扱います。

`needsApproval` が省略された場合、動作はバイトごとに変更されません。共通パスに追加のコストはかかりません。

これは、従来の `parameters` スタイルの actions とスキーマ ベースの actions、およびアプリ内エージェント、サブエージェント、A2A、および MCP 呼び出し元でも同様に機能します (すべてのエージェント サーフェスは同じループを介してルーティングされます)。

## ループの一時停止方法 {#loop}

エージェントがゲート アクションを呼び出し、この特定の呼び出しがまだ承認されていない場合、ループは `run()` を実行しません\*\*。代わりに:

1. ゲートを解決します。述語の場合、`needsApproval(input, ctx)` を呼び出します。スローは「承認が必要」（フェイルクローズ）として扱われます。
2. `tool_start` イベントを発行し (UI が呼び出しを表示するように)、その直後に **`approval_required`** イベントが続き、ターンを停止します。アクションの副作用は決して起こりません。

`approval_required` イベントには、クライアントがアフォーダンスをレンダリングするために必要なものがすべて含まれています。

| フィールド    | タイプ       | メモ                                                                                |
| ------------- | ------------ | ----------------------------------------------------------------------------------- |
| `tool`        | `string`     | エージェントが呼び出そうとしたアクション名。                                        |
| `input`       | オブジェクト | エージェントが渡した引数。                                                          |
| `approvalKey` | `string`     | **安定したキー** クライアントは、*この呼び出し*を承認するためにエコーバックします。 |
| `toolCallId`  | `string`     | モデル側のツール呼び出し ID (使用可能な場合)。                                      |

`approvalKey` はツール名とその入力から決定論的に導出されるため、同じ論理呼び出しでは常に同じキーが生成されます。モデルがそれを確認したり設定したりすることはありません。これは純粋にフレームワークと人間の承認アフォーダンスの間のハンドシェイクです。

一時停止されたツールは、ターンが一時停止され、再試行しないようにモデルに通知する結果を返すため、モデルは回転しません。

## 人間がどのように承認するか {#approve}

`approval_required` では、チャット UI が、一時停止されたツール呼び出しに対して **承認/拒否** アフォーダンスをレンダリングします。これは `AssistantChat` で自動的に接続されます。テンプレートごとに構築する必要はありません。

- **Approve** は、`approvedToolCalls: [approvalKey]` にコールのキーを含むターン (通常の継続メッセージ) を再発行します。再発行されたターンでは、ゲートは承認されたセット内のキーを確認し、その特定の呼び出しを通常どおり実行できるようにします。
- **Deny** はアフォーダンスをローカルで拒否します。何も再発行されないため、アクションは実行されません。

`approvedToolCalls` は、チャット リクエスト (`AgentChatRequest.approvedToolCalls`) のフィールドです。その中に存在しないキーは一時停止されたままになります。1 つの通話を承認しても、他の通話が白紙に承認されることはありません。キーはコンテンツでアドレス指定されているため、承認により、*それらの引数を使用した呼び出し*が許可されます。後でモデルが別の送信を提案した場合、それは新しいキーと新たな承認になります。

## エンドツーエンド {#flow}

```an-diagram title="承認の中断" summary="ゲート呼び出しは、run() が起動される前にターンを一時停止します。承認により、コールのキーを保持するターンが再発行されます。そうして初めて副作用が起こります。"
{
  "html": "<div class=\"diagram-approve\"><div class=\"diagram-box\" data-rough>エージェントがsend-emailを呼び出す</div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-panel warn\" data-rough><strong>Gateはtrue、呼び出しは未承認</strong><small class=\"diagram-muted\">loop emits tool_start + approval_required { tool, input, approvalKey }</small><span class=\"diagram-pill warn\">turn pauses &mdash; run() did NOT execute</span></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-box\" data-rough>人がチャットで承認をクリック<br><small class=\"diagram-muted\">クライアントがapprovedToolCalls: [approvalKey]でターンを再発行</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-panel ok\" data-rough><span class=\"diagram-pill ok\">Gate sees the key &rarr; run() executes &rarr; email sends</span></div></div>",
  "css": ".diagram-approve{display:flex;flex-direction:column;align-items:center;gap:8px}.diagram-approve .diagram-panel{display:flex;flex-direction:column;gap:6px;align-items:center;padding:12px 16px;text-align:center}.diagram-approve .diagram-arrow{font-size:22px;line-height:1}"
}
```

フレームワークにおけるこのゲートの標準的な (そして意図的にまれな) 使用法は、メール テンプレートの `send-email` アクションです。これにより、`needsApproval: true` が設定されるため、エージェントは自由にドラフトしてキューに入れることができますが、特定の送信を人間が承認しないと実際にメッセージを送信することはできません。

## 関連

- [**Actions**](/docs/actions#needs-approval) — 戻り値を検証するための `outputSchema` を含む、完全な `defineAction` サーフェス。
- [**Security**](/docs/security) — 承認ゲートに到達するタイミングとモデルからアクションを非表示にするタイミング。
- [**Mail template**](/docs/template-mail) — `send-email` は参考例です。
