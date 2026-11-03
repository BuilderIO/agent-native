---
slug: weekly-business-review
type: how-to-guide
title: 如何开好每周业务回顾
seo_title: 如何开好每周业务回顾（WBR）
og_line: 本周注册数与目标的对照
meta_description: "开好每周业务回顾：挑选一份简短的指标清单，为每个指标指定负责人，制作自动刷新的图表，把一小时花在有变化的地方。"
og_image: https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F9daf6b49d52a4bd7934bea78f3283e3b
published: 2026-11-03
updated: 2026-11-03
author:
  name: Vishwas Gopinath
  url: https://x.com/CodevolutionWeb
  same_as:
    - https://x.com/CodevolutionWeb
app: Analytics
cta:
  label: 搭建仪表板
  url: https://analytics.agent-native.com
  heading: 用 Agent-Native Analytics 搭建 WBR 仪表板
  prompt: "阅读 https://www.agent-native.com/zh-CN/articles/weekly-business-review/ ，帮我搭建一个每周业务回顾仪表板。先问我数字存放在哪些工具里、每周要回顾哪些指标、哪些是我们能控制的、哪些是我们被考核的、每个指标的负责人、每个指标怎么统计，以及有没有目标值。然后搭建一个仪表板，按业务的每个部分分区：每个核心数字一个卡片并与上一周对比，每个指标一张过去 13 周的周度图表，带上去年同期和目标值，并把我们的发布标为关键日期。"
use_case: ai-kpi-dashboard
images:
  - dark: https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2Fe8ab172efb9a44548a08a45deb537de7
    light: https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2Facbde1387e614d10875b8598b84e9ad0
    alt: 虚构公司 Northpine 的 WBR 仪表板。客户分区里有试用注册数（412，比上一周增长 18%）、已进行的销售通话数和流失客户数的卡片。下方是过去 13 周的周度图表，带有去年同期的折线和一条虚线目标。再往下是收入和产品的卡片。
  - dark: https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2Ff4005f26b97f4bc881b056e66419e1b3
    light: https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F83d2f1386f2644d49cf12d53ac910cf0
    alt: 一张试用注册数的周度图表，x 轴上标有 10 月 20 日定价页上线的关键日期，悬停卡片已打开。一条灰色色带标出注册跟踪出故障的那一周。
  - dark: https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2Fd0e46aefdcb54bccb7f7d8c145bfb0b2
    light: https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F68bcf5d05058448abd4e41323aca53a6
    alt: Analytics 的“数据源”页面，已连接 Stripe、HubSpot、Amplitude 和 Google Analytics；Stripe 的设置面板显示密钥已配置，连接测试成功。
  - dark: https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F3efd2a95ab7846a5bb1d3c68460e8c4a
    light: https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2Fb6b6a7d08d4e412293771ca7cf811389
    alt: 完整的 Analytics 窗口，左侧是侧边栏，中间是 Northpine 的 WBR 仪表板。右侧的代理对话中，代理已根据描述搭建了 2 个分区、6 个卡片和 4 张图表。
  - dark: https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F04077c976b0949cc858e58fc0f52bb9f
    light: https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F0e60e8d339144a1086f05a0562e1ea60
    alt: 编辑模式下打开的“标注”菜单，包含 Launches 和 Pricing changes 两组关键日期、“添加关键日期”，以及一条 Signup tracking gap 数据备注。
  - dark: https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2Fdc99c51c5c63429584e42d7bc0aace70
    light: https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2Fc18c88f4368f44a7a58ccf9605ff7582
    alt: 选中的试用注册数图表，代理对话正在回答上周注册数为何上升，并附上一张这两周按来源划分的注册数表格。
faqs:
  - q: 什么是 WBR 会议？
    a: WBR，即每周业务回顾（weekly business review），是每周围绕同一组指标召开的定期会议。负责业务的人针对有变化的指标商定行动。这种形式因 Amazon 而广为人知：指标顺序固定，由负责人解释每一个变化。
  - q: WBR 和 MBR 有什么区别？
    a: WBR 看上周的数字，以便及早发现问题并采取行动。每月业务回顾（MBR）则放眼趋势、目标以及指标清单本身。两种会都开的团队，两边用的是同一套指标。如果是面向客户的季度回顾，参见如何制作 QBR 演示文稿。
  - q: 每周业务回顾应该包含哪些指标？
    a: WBR 应该包含少量能反映业务各部分上周表现的指标，以及背后的输入指标。对软件公司来说，通常是注册数、销售活动、收入、流失客户数和客服积压。每个指标都需要一位负责人和一份书面定义。
  - q: 每周业务回顾应该开多长时间？
    a: "每周业务回顾最多一小时，每周固定在同一时间。只要工作在会前完成，一小时就够了：图表会自动刷新，负责人也已经写好了变化说明。"
  - q: WBR 应该用演示文稿还是仪表板？
    a: 每周回顾更适合用仪表板，因为它从你的数据自动刷新，没人需要重新制作。演示文稿更适合每月和每季度的回顾，因为那时需要围绕数字讲一个故事。如果团队更喜欢幻灯片，就保留一组固定的、会自动刷新的图表，避免每周重新做幻灯片。
---

要开好每周业务回顾（WBR），先挑选一份简短的指标清单，为每个指标指定一位负责人，并制作能自动刷新的图表。然后每周开一小时会，只讨论有变化的图表。本指南教你把这些一次性搭建好，让每周的工作只剩下看图表和决定怎么做。

![虚构公司 Northpine 的 WBR 仪表板。客户分区里有试用注册数（412，比上一周增长 18%）、已进行的销售通话数和流失客户数的卡片。下方是过去 13 周的周度图表，带有去年同期的折线和一条虚线目标。再往下是收入和产品的卡片。](https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2Fe8ab172efb9a44548a08a45deb537de7)

## 准备工作

- 存放各项数字的工具的访问权限
- 业务每个部分的负责人
- 每周固定的会议时段

## 如何开好每周业务回顾

### 1. 挑选一份简短的指标清单

**业务的每个部分都控制在一屏之内**。本指南中的虚构公司 Northpine 分为两个部分：客户，以及收入和产品。

团队被考核的每个结果都是输出指标，比如新增月度经常性收入。在它旁边，放一个团队在下周之前就能改变的输入指标，比如预约首次会议的试用用户占比。输出指标告诉你做得怎么样，输入指标告诉你该改什么。

Northpine 的清单开头是这样的：

| 指标 | 输入还是输出 | 来自哪里 |
|---|---|---|
| 新增月度经常性收入 | 输出 | 计费系统 |
| 已进行的销售通话 | 输入 | CRM |
| 试用注册数 | 输入 | 产品分析 |
| 预约首次会议的试用用户 | 输入 | 产品分析 |
| 流失客户数 | 输出 | 计费系统 |
| 超过两天未处理的客服工单 | 输入 | 客服工具 |

如果某个指标翻倍也没人会采取行动，就把它去掉。如果市场团队会发[每周营销报告](https://www.agent-native.com/use-cases/weekly-marketing-report/)，只引入其中的核心数字。

### 2. 为每个指标指定负责人和定义

WBR 里的每个数字都需要一个人对它负责。**写下每个指标的统计方式**：包括哪些内容、来自哪个工具、覆盖哪一周（例如按同一时区的周一到周日）。把负责人和定义作为两列加到指标清单里。

有了定义，会议就不会争论数字本身，而是讨论业务。定义变更时记下日期，这样图表上出现跳变时就有据可查。

### 3. 把每个指标与去年对比制成图表

单看一个数字，无法判断这周表现好不好。**为每个指标做一张周度图表**，展示过去 13 周的数据，带上去年同期和目标值。这种形式因 Amazon 的 WBR 而广为人知。如果还没有一整年的数据，就先把最近几周与目标值对比，以后再加上去年的数据。

对少数几个核心数字，再加一个卡片，显示本周数值以及与上一周相比的变化。按业务部分、按讨论顺序给图表分组，就像本指南开头的仪表板那样。

在仪表板或能自动刷新的联网表格里搭建一次就好。幻灯片适合每月或每季度的回顾，但每周重做一份演示文稿，正是让团队放弃 WBR 的原因。第一次开会前，和各位负责人一起把图表过一遍，对数字达成一致。

### 4. 确定时间、参会人员和议程

**每周在同一时间开 WBR**，最多一小时。放在一周的前几天，等上周的数字完整之后再开。邀请指标负责人和决定怎么做的人，只来旁听的人不用邀请。指定一个人主持：把控顺序、控制时间、记录行动项。

议程只写一次，顺序与仪表板一致，放在一份每周重复使用的共享文档里。Northpine 的议程是：

1. 之前几周未完成的行动项
2. 客户
3. 收入和产品
4. 图表没有反映的其他事项（如果有时间）

### 5. 会前让负责人记下变化

每位负责人在 WBR 前一天结束前看完自己的图表。**为任何偏离常态的图表写一条简短说明**，放在议程文档中对应的分区下。写出你已经知道的原因，或者说明还不清楚、什么时候会弄清楚。和过去几周差不多的图表不用写说明，这样说明就能指出会议该关注哪里。

Northpine 负责注册的 Dana 写道：“试用注册 412，上周是 349。增长主要来自自然搜索，从新定价页上线那周开始。周三前排查各落地页。”

发布、价格调整和故障一发生就标在图表上，这样以后看到某个峰值的人都能知道原因。如果某段时间数字有误，比如跟踪代码坏了，也要把这段时间标出来，以免有人据此行动。

![一张试用注册数的周度图表，x 轴上标有 10 月 20 日定价页上线的关键日期，悬停卡片已打开。一条灰色色带标出注册跟踪出故障的那一周。](https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2Ff4005f26b97f4bc881b056e66419e1b3)

### 6. 把会议时间花在有变化的地方

先看未完成的行动项。然后按仪表板的顺序逐个分区过，**只在有说明的图表上停下来**。由负责人解释，大家提问，直到原因清楚了，或者有人答应去查。

图表就是议程，所以没人需要做汇报。如果有人开始逐一讲自己团队的项目，就把大家拉回到图表和数字上。

### 7. 为每张被标记的图表指定负责人

会上停下来讨论的每张图表，最后都要落实到**一个人和一个回复日期**。主持人把这些写在下周议程的最上方，比如“排查带动注册增长的落地页：Dana，周三”。如果大家决定先观察，也要写下来，并注明哪一周再看。

### 8. 有计划地调整指标清单

随着你了解哪些输入指标能带动输出指标，指标清单会不断变化。**按固定周期调整清单**，比如在每月业务回顾上，绝不在 WBR 中途调整。删掉几个月都没人采取行动的指标，加上你一直在追问的输入指标，同时更新负责人和定义。

## 如何用 Agent-Native Analytics 开好每周业务回顾

Analytics 负责搭建和刷新[周度图表](#3-把每个指标与去年对比制成图表)，保存[每个指标的定义](#2-为每个指标指定负责人和定义)，并在图表上标出[发布和错误数据](#5-会前让负责人记下变化)。选择指标、主持会议、撰写说明和行动项，仍然由你来做。Analytics 目前处于 alpha 阶段。

### 1. 连接存放数字的工具

打开**数据源**，连接指标清单上的每个工具，比如 Stripe、HubSpot、Google Analytics、Amplitude 或 BigQuery。每个数据源都有设置引导和一个**测试连接**按钮，[Analytics 数据源指南](https://www.agent-native.com/docs/template-analytics-connectors/)列出了每个数据源需要什么。

![Analytics 的“数据源”页面，已连接 Stripe、HubSpot、Amplitude 和 Google Analytics；Stripe 的设置面板显示密钥已配置，连接测试成功。](https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2Fd0e46aefdcb54bccb7f7d8c145bfb0b2)

### 2. 描述你的 WBR 仪表板

点击**新仪表板**并描述它：有哪些分区，每个指标及其来源。要求为每个核心数字加一个显示与上一周相比变化的卡片。然后要求为每个指标做一张过去 13 周的周度图表，带上去年同期和目标值。

代理会搭建卡片和图表，检查它们能正常显示，然后打开仪表板。每张图表都会从数据源自动刷新，所以没人需要在会前重新制作。

![完整的 Analytics 窗口，左侧是侧边栏，中间是 Northpine 的 WBR 仪表板。右侧的代理对话中，代理已根据描述搭建了 2 个分区、6 个卡片和 4 张图表。](https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F3efd2a95ab7846a5bb1d3c68460e8c4a)

### 3. 添加定义和关键日期

把每个指标的定义放到**语义层**页面，这样代理每周都会用同样的方式统计。只有组织管理员能修改那里的定义。

要标记一次发布，在编辑模式下打开**标注**，选择**添加关键日期**，或者直接告诉代理。**添加数据备注**用来标出数字有误的时间段。每张图表的**查看 SQL** 会显示它的数字是怎么统计的。文档对[仪表板、关键日期和邮件报告](https://www.agent-native.com/docs/template-analytics-dashboards/)有更详细的介绍。

![编辑模式下打开的“标注”菜单，包含 Launches 和 Pricing changes 两组关键日期、“添加关键日期”，以及一条 Signup tracking gap 数据备注。](https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F04077c976b0949cc858e58fc0f52bb9f)

### 4. 共享仪表板并询问变化原因

把仪表板以编辑者身份共享给指标负责人，方便他们添加关键日期；以查看者身份共享给其他所有人。会前，负责人在对话框中用**选择**选中一张图表，询问代理它为什么有变化。代理会编写并检查查询，然后用图表、表格或数字给出回答。

邮件报告每天发送，没有按周发送的选项，所以开 WBR 时直接打开仪表板本身。

![选中的试用注册数图表，代理对话正在回答上周注册数为何上升，并附上一张这两周按来源划分的注册数表格。](https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2Fdc99c51c5c63429584e42d7bc0aace70)

了解 [Agent-Native Analytics 如何搭建 KPI 仪表板](https://www.agent-native.com/use-cases/ai-kpi-dashboard/)。

## 常见情况

### 数字突然跳变，但谁都没改过什么

是定义或来源变了：新增了筛选条件、事件被改名，或者跟踪代码坏了。检查图表的查询或数据所在的工具。在指标清单中修正定义，然后在图表上标出受影响的几周，以免会议据此行动。

### 大家都在讲自己的项目，而不是数字

会议没有规定在哪里停下，所以每个人都会把时间填满。用说明作为规则：只在有说明的图表上停下来。项目进展写成书面更新，在会前发出。

### 所有指标都是绿色，会议显得毫无意义

要么目标定得太低，要么清单里只有输出指标，而输出指标每周变化很慢。为每个输出指标加上背后的输入指标，比如[注册漏斗](https://www.agent-native.com/use-cases/ai-funnel-analysis/)的每一步，并设定团队偶尔会达不到的目标。

## 常见问题

### 什么是 WBR 会议？

WBR，即每周业务回顾（weekly business review），是每周围绕同一组指标召开的定期会议。负责业务的人针对有变化的指标商定行动。这种形式因 Amazon 而广为人知：指标顺序固定，由负责人解释每一个变化。

### WBR 和 MBR 有什么区别？

WBR 看上周的数字，以便及早发现问题并采取行动。[每月业务回顾（MBR）](https://www.agent-native.com/articles/monthly-business-review/)则放眼趋势、目标以及指标清单本身。两种会都开的团队，两边用的是同一套指标。如果是面向客户的季度回顾，参见[如何制作 QBR 演示文稿](https://www.agent-native.com/articles/qbr-presentation/)。

### 每周业务回顾应该包含哪些指标？

WBR 应该包含少量能反映业务各部分上周表现的指标，以及背后的输入指标。对软件公司来说，通常是注册数、销售活动、收入、流失客户数和客服积压。每个指标都需要一位负责人和一份书面定义。

### 每周业务回顾应该开多长时间？

每周业务回顾最多一小时，每周固定在同一时间。只要工作在会前完成，一小时就够了：图表会自动刷新，负责人也已经写好了变化说明。

### WBR 应该用演示文稿还是仪表板？

每周回顾更适合用仪表板，因为它从你的数据自动刷新，没人需要重新制作。演示文稿更适合每月和每季度的回顾，因为那时需要围绕数字讲一个故事。如果团队更喜欢幻灯片，就保留一组固定的、会自动刷新的图表，避免每周重新做幻灯片。
