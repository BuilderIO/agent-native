---
title: "观察记忆"
description: "后台三层压缩（最近的原始→观察→反射），使长代理线程保持廉价且提示缓存稳定，而无需触及短对话。"
---

# 观察记忆

长时间运行的代理线程会积累巨大的记录：每条消息、每个工具调用、每个结果。每回合将整个历史记录重播到模型中的成本很高，并且最终会破坏上下文窗口。 **观察记忆 (OM)** 将长线程的较旧部分压缩为过时的分层摘要，因此模型仍然知道发生了什么 - 只需令牌成本的一小部分 - 而最近的回合则保持逐字记录。

OM 是完全自动的且仅限于所有者范围。 **短线程不受影响**：在线程跨越第一个压缩阈值之前，OM 是无操作的，并且上下文是逐字节的，没有它时的情况。

## 三层 {#tiers}

OM 将长线程表示为三层，从最精炼到最近：

| 层级               | 它是什么                                                                    |
| ------------------ | --------------------------------------------------------------------------- |
| **思考**           | 最高级别，由观察日志变大后浓缩而成。长弧总结。                              |
| **观察**           | 密集、过时的条目将一段原始消息折叠成所发生事件的紧凑记录。                  |
| **最近的原始消息** | 最后 N 个回合，**逐字**保存 — 从未折叠 — 因此代理始终可以看到最新的上下文。 |

```an-diagram title="三层，提炼到最近" summary="较旧的前缀折叠成过时的观察结果和长弧反射；只有最近的轮次才保留原样。"
{
  "html": "<div class=\"om\"><div class=\"diagram-card\"><span class=\"diagram-pill\">反思</span><small class=\"diagram-muted\">从观察日志浓缩出的长期摘要</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&uarr;</div><div class=\"diagram-card\"><span class=\"diagram-pill accent\">观察</span><small class=\"diagram-muted\">带日期的密集条目，折叠多段原始消息</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&uarr;</div><div class=\"diagram-card\"><span class=\"diagram-pill ok\">最近的原始消息</span><small class=\"diagram-muted\">last N turns, kept <strong>verbatim</strong> — 永不折叠</small></div></div>",
  "css": ".om{display:flex;flex-direction:column-reverse;align-items:stretch;gap:8px}.om .diagram-card{display:flex;flex-direction:column;gap:4px;padding:12px 16px}.om .diagram-arrow{text-align:center;font-size:20px;line-height:1}"
}
```

在每一轮中，读取端将它们组装成一个自标记的 `[Observational Memory]` 块，该块替换原始的较旧前缀，保持最近原始窗口完整，并告诉模型将压缩记录视为权威（不要重做已完成的工作，信任记录的决策、名称、日期和状态）。

## 压缩如何运行 {#compaction}

两次传递以“即发即忘、尽力而为”的方式运行，在一次干净的转弯之后，因此它们不会给用户可见的响应增加延迟，并且任何失败都会被吞掉：

1. **观察者** - 一旦线程的*unobserved*消息超过观察标记阈值，将它们折叠成单个密集观察条目。
2. **Reflector** — 一旦持久观察日志本身超过反射令牌阈值，就会将观察结果压缩为更高级别的反射。

```an-diagram title="干净利落的转弯后两次尽力传球" summary="每次传递都不会低于其阈值，因此每轮运行压缩器都很便宜。故障会被吞掉，并且不会增加延迟。"
{
  "html": "<div class=\"om-pass\"><div class=\"diagram-node\">干净回合结束<br><small class=\"diagram-muted\">fire-and-forget</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-card\"><span class=\"diagram-pill accent\">Observer</span><small class=\"diagram-muted\">unobserved tokens &gt; 30k? &rarr; fold into one observation</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-card\"><span class=\"diagram-pill accent\">Reflector</span><small class=\"diagram-muted\">observation log &gt; 40k? &rarr; condense into a reflection</small></div></div>",
  "css": ".om-pass{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.om-pass .diagram-node,.om-pass .diagram-card{display:flex;flex-direction:column;gap:2px;padding:10px 14px}.om-pass .diagram-arrow{font-size:22px;line-height:1}"
}
```

两者都通过低于其阈值的无操作，因此在每轮之后调用压缩器是便宜的。由于 OM 用稳定的压缩文本替换了易失的原始前缀，因此它还可以在长线程的轮流中保持提示**缓存稳定**。

OM 数据存在于应用程序自己的 SQL 数据库中，其范围仅限于所有者（以及存在的组织）——与框架的其余部分具有相同的范围模型。它永远不会在用户之间共享。

## 配置 {#config}

默认值是保守的。操作员可以在部署时使用 `AGENT_NATIVE_OM_*` 环境变量进行压缩（无需重新部署应用程序代码）；无效或缺失的值始终会回退到指定的默认值。

| 环境变量                                      | 默认    | 它控制什么                                           |
| --------------------------------------------- | ------- | ---------------------------------------------------- |
| `AGENT_NATIVE_OM_OBSERVATION_TOKEN_THRESHOLD` | `30000` | 未观察到的消息标记，触发观察者将它们折叠成一个观察。 |
| `AGENT_NATIVE_OM_REFLECTION_TOKEN_THRESHOLD`  | `40000` | 触发反射器凝结成反射的观察日志标记。                 |
| `AGENT_NATIVE_OM_RECENT_RAW_MESSAGE_COUNT`    | `12`    | 有多少最新消息会逐字保留（从未合并到观察中）。       |

观察者和反射器输出上限（4000 / 2000 代币）可防止单次压缩传递超出预算；它们可以通过 `resolveObservationalMemoryConfig({ ... })` 在代码中进行调整，但不能暴露在环境中。

> [!TIP]
> 降低阈值以更快地压缩（更便宜的长线程，稍微更多的摘要）；在压缩之前提高它们以在上下文中保留更多原始历史记录。如果您的工作流程需要更长的逐字尾部，请将 `AGENT_NATIVE_OM_RECENT_RAW_MESSAGE_COUNT` 设置得更高。

## 当它开始时 {#when}

OM 仅更改足够长的线程的行为，以产生至少一个观察或反射。具体来说：

- 一个全新的或短的线程：还没有 OM 条目 → 上下文是纯文本，未更改。
- 长线程已超过观察阈值：较旧的前缀被压缩的 `[Observational Memory]` 块替换，最近的原始尾部保持原样，并且令牌使用量大幅下降。

注入是尽力而为且边界安全的 - 如果找不到安全调整点（例如，待处理的工具使用/结果对位于窗口边缘），OM 将*附加*注入内存块而不进行调整，而不是冒险丢弃待处理的工具结果。

## 相关

- [**Using Your Agent**](/docs/using-your-agent) — 与停靠在您的应用旁边的代理一起工作的日常循环。
- [**Observability**](/docs/observability) — 每次运行的令牌和成本指标，其中显示 OM 的节省。
- [**Custom Agents & Teams**](/docs/agent-teams) - 长子代理运行受益于相同的压缩。
