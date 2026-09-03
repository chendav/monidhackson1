# Monid “We Kill” Hackathon — 项目上下文

> 状态：来自 ChatGPT 对话《解释比赛内容》的整理版项目上下文  
> 对话时间：2026-09-02  
> 原始对话 ID：`6a98ce79-b0fc-83e8-a6c3-c2044f0e05ab`  
> 官方入口：https://hacks.monid.ai/

## 0. 一页结论

本项目拟参加 Monid “We Kill” Hackathon。当前方向已经从“大而全的 Agent 产品”收敛为一个可在 60–90 秒内讲清价值、能由多个 Monid endpoint 共同完成、并且有明确成本对比的单一工作流：

> **Agent-native Competitive Intelligence / Battlecard API**  
> 输入两个公司或产品，自动完成多源竞争研究、证据归一化、关键判断校验，并输出带证据链和置信度的 battlecard。

示例输入：

```text
Analyze HubSpot vs Salesforce
```

核心链路：

```text
Competitor Research → Evidence → Verified Claims → Battlecard
```

当前仍不能直接宣布“Kill Klue”或“Kill Crayon”。比赛讨论中确认了一个关键硬条件：**正式被替代的 SaaS target 必须有公开价格（published price）**。因此应先锁定工作流，再寻找真正符合规则、提供公开定价且核心价值与该工作流高度重合的具体 SaaS。

接下来只做两项决定性工作：

1. 找到符合比赛规则、具有公开价格的具体 Competitive Intelligence / Battlecard SaaS target。
2. 核实 Monid catalog 中实现该工作流所需的真实 endpoints、schema、单价与完整单次运行成本（包括失败调用）。

完成这两项后，才能最终决定 “We killed ___” 中的产品名，以及 MVP 需要实现的准确调用链。

---

## 1. 比赛到底要做什么

这不是一个泛化的 “做个 AI Agent” 比赛。比赛倡导把传统、面向人类 UI 和按席位/月收费的 SaaS 中某个真正有价值的工作流拆出来，重做为：

```text
Agent → 按需调用多个能力/API → 直接交付结果 → 按次计费
```

典型对比：

```text
传统 SaaS：$99/month
Agent-native workflow：$0.37/run
```

比赛期待的 “kill” 不是复制整个 SaaS，也不是只包一层 API，而是替代其中一个清晰、完整、可被用户理解和复用的核心工作流。

### 对话中整理出的关键规则与评分信号

以下信息来自当时对官方页面、FAQ 和 submission guide 的研究摘要。提交前必须回到官方页面逐条复核最新版本。

- 比赛时间：2026-09-01 至 2026-09-10。
- 团队最多 3 人。
- 可以基于已有项目开发，但用于参赛评审的 Monid integration 和 “kill” 部分需要在比赛期间新增，并用 Git commit history 证明。
- 正式 target 的硬要求是具有公开价格；仅有 “Get a Demo / Talk to Sales” 而无公开价格的产品不适合作为最终 target。
- 必须使用真实数据和真实调用；mock data 不算。
- 需要报告真实 measured cost，包含失败调用产生的成本。
- 建议视频控制在 90 秒以内，并让 before/after 与价格差在最短时间内被看懂。
- 官方建议至少把约一半时间留给 demo 和视频，而不是直到最后一天才开始制作传播材料。
- Monid 的推荐开发流程是 `discover → inspect schema → run`；讨论中记录为 discover 免费且 unlimited，收费发生在 run。实现前需再次核对当前规则。

讨论中记录的总分结构为 850 分：

| 部分 | 分数 | 含义 |
|---|---:|---|
| Judges | 400 | 产品和替代效果本身 |
| Reach | 250 | 在 X、LinkedIn、Instagram、TikTok、YouTube 发布视频 |
| Viral | 200 | 视频总播放量 |

Judges 部分重点关注：

- 是否真的替代了一个 SaaS 的有价值工作流。
- 是否超越 tutorial 或单一 API wrapper。
- demo / 视频是否清楚、有冲击力。
- 是否是别人真正愿意使用的产品。
- 是否诚实限定替代范围，而不是夸大为“替代整个企业软件”。

讨论中记录的奖金总额约为 $4,015，第一名约 $2,000，主要以 Claude credits 和 Monid credits 形式提供。奖金不是选择方向的核心依据；更重要的是产品叙事、获奖曝光和赛后延展性。金额与形式提交前也需复核。

---

## 2. 为什么不能只做一个 API wrapper

对话中提炼出的官方获胜信号是：

> 一个 API call 只是 wrapper；把多个调用组合成单一供应商无法直接出售的最终结果，才构成真正的 “kill”。

因此技术亮点不能只是“调用了 8 个 API”，而应该是多个数据源之间的证据协调：

```text
Source → Evidence → Claim → Confidence → Strategic implication
```

示例：

- 官网说 Product X 从 `$49` 起。
- Reddit 用户反馈实际可用版本需要 `$99` tier。
- YouTube review 显示某关键 feature 仅限 Pro。
- 新闻显示三个月前刚发布新版本。
- LinkedIn 招聘趋势显示公司正在扩大 enterprise sales。

Agent 的工作不是把这些内容简单拼成摘要，而是：

1. 保存每条来源与抓取时间。
2. 抽取可以验证的 evidence。
3. 合并或标出互相冲突的 claim。
4. 给 claim 分配置信度。
5. 推导对销售或产品策略有用的 implication。
6. 让 battlecard 中每个关键结论都能回溯到 evidence URL。

这正是本项目相对于“让通用聊天模型搜索一下竞争对手”的核心差异。

---

## 3. Monid 能力快照

对话研究时，Monid 被描述为 “OpenRouter for Tools”：一个 key、统一接口、按调用付费，向 Agent 暴露 1,900+ 外部工具/API。

讨论中确认或提及的相关能力包括：

- Web / semantic search：Exa 等。
- 实时新闻与 company news。
- Company / person enrichment：People Data Labs（PDL）。
- Sales / contacts：Apollo。
- Private market research：Wokelo。
- Browser automation / scraping：Browserbase、Apify。
- 社交与内容来源：LinkedIn、Reddit、X、TikTok、Instagram、YouTube。
- 商品与评论来源：Amazon、Google Reviews。
- 其他被平台展示的能力：ElevenLabs、视频生成、天气、微信、小红书等。

这里列的是方向选择阶段的能力快照，不等于最终 endpoint 清单。MVP 只能依赖已经通过 Monid catalog 实际 discover、检查过 schema、成功运行过并测出价格的 endpoint。

---

## 4. 候选方向与排序

第一轮研究按开发难度、视频表现、商业价值和 Monid 多 endpoint 组合空间，列出了以下方向：

| 排名 | Kill target / workflow | 核心输出 | 可能使用的 Monid 能力 | 开发难度 | 视频效果 | 商业价值 | 综合 |
|---:|---|---|---|:---:|:---:|:---:|---:|
| 1 | Sales Intelligence / Prospecting | 自然语言 ICP → 公司、决策者、联系方式、触发事件、名单 | Apollo + PDL + LinkedIn + Exa + News | ★★ | ★★★★★ | ★★★★★ | 9.5 |
| 2 | Competitive Intelligence | 公司/产品 → 完整竞争情报报告 | Exa + News + LinkedIn + Reddit + scraping | ★★ | ★★★★★ | ★★★★★ | 9.3 |
| 3 | Private Market Research | 私企 → 融资、管理层、竞争格局、投资 memo | Wokelo + PDL + Apollo + Exa + News | ★★★ | ★★★★★ | ★★★★★ | 9.2 |
| 4 | Influencer Discovery | 产品 → 发现、验证并排序 KOL | TikTok + Instagram + YouTube + X + enrichment | ★★ | ★★★★★ | ★★★★ | 9.0 |
| 5 | Brand / Social Listening | 品牌 → 全网舆情、抱怨、趋势、竞品 | Reddit + X + TikTok + YouTube + News | ★★ | ★★★★★ | ★★★★ | 8.9 |
| 6 | SEO / GEO Platform | 关键词 → 竞品、内容机会、文章 | Search + Exa + scraping + SEO data | ★★★ | ★★★★ | ★★★★★ | 8.6 |
| 7 | Review Intelligence | 聚合并分析商品/品牌用户评论 | Amazon + Google Reviews + Reddit | ★ | ★★★★ | ★★★★ | 8.5 |
| 8 | Recruiting Sourcing | 岗位 → 候选人、履历验证、排序 | PDL + LinkedIn + Apollo + web | ★★ | ★★★★ | ★★★★★ | 8.4 |
| 9 | Company Monitoring | 公司融资、招聘、管理层、新闻、产品变化 | News + LinkedIn + Exa + scraping | ★★ | ★★★ | ★★★★ | 8.0 |
| 10 | Due Diligence Research | 公司 → 多源 DD、红旗、证据链 | Wokelo + Exa + PDL + News + scraping | ★★★★ | ★★★★ | ★★★★★ | 8.0 |

### 候选 1：Sales Intelligence

最初判断其获奖概率最高。它可以把一句自然语言需求直接变成可行动的 prospect list：

```text
Find 20 Canadian accounting firms with 10–100 employees that are
growing, use QuickBooks, and likely need an AI bookkeeping automation
product. Find the decision maker and explain why I should contact them.
```

理想输出包含公司、决策者、人数、技术栈、触发信号、why now、联系方式与置信度。真正的价值链是：

```text
Lead → Enrichment → Intent → Evidence → Decision
```

优点是需求清楚、价值高、Apollo / PDL / LinkedIn / News 组合自然；缺点是更容易被看成“另一个 prospecting 工具”，也未必最贴合当前项目背景。

### 候选 2：Competitive Intelligence

输入公司或产品，自动研究官网、定价、竞品、评论、社交讨论、招聘和新闻，输出：

- Market position
- Top competitors
- Pricing matrix
- Feature matrix
- Customer complaints / customer love
- Recent momentum
- Competitive threats
- Strategic opportunities
- Sources / evidence

优点：before/after 非常直观，多源研究是必要条件，结果能做成漂亮的报告，单次成本与 SaaS 月费之间也容易形成视频冲击力。

### 候选 3：Private Market Intelligence

输入一个私营公司作为收购标的，结合 Wokelo、PDL、Apollo、LinkedIn、Exa、News 和官网抓取，输出 Mini Investment Committee Memo，包括公司概览、所有权、管理层、融资、规模、增长信号、客户、竞争对手、近期事件、红旗和待确认问题。

这是赛后最容易延展成 Commercial DD、Technical DD、Data-center DD 和完整 AI Due Diligence Platform 的方向，也很贴合既有投资研究经验；但在 10 天比赛中，范围更大、验证成本更高，demo 不如单一 battlecard workflow 紧凑。

### 最终为何选择 Competitive Intelligence

综合判断选择 #2，而不是综合排名第一的 Sales Intelligence 或赛后潜力最高的 Private Market Intelligence，原因是：

- 10 天内可以做出完整、可信的端到端 workflow。
- 输入与输出都极简，观众几秒内能理解。
- 多源数据是业务必需，而不是为了展示 API 数量硬凑。
- evidence reconciliation 能明显超越普通聊天式搜索。
- 报告 / battlecard 的视觉表现适合 90 秒 demo。
- 能诚实地限定为替代核心 research-to-battlecard 流程，不需要复制企业级 CI 套件全部功能。
- 赛后仍能向持续监控、销售 enablement、DD 等方向扩展。

---

## 5. 正式产品定义

### 产品名（工作名）

**Agent-native Competitive Intelligence / Battlecard API**

### 用户承诺

用户只需要输入两个公司或产品：

```text
Analyze HubSpot vs Salesforce
```

系统自动完成：

```text
官网 / 定价 / 产品 / 新闻 / 社交 / 评论
                  ↓
             Evidence Store
                  ↓
          Claim Verification
                  ↓
        Competitive Analysis
          ↙       ↓       ↘
       Pricing  Strengths  Weaknesses
                  ↓
              BATTLECARD
```

### 明确替代的范围

目标是替代 CI 产品价值链中的一段完整工作流：

```text
Collect → Analyze → Create
```

具体为：自动抓取网站、定价、产品变化、新闻、评论和公开讨论，归一化为证据，形成 competitor profile / battlecard。

### 明确不声称替代的范围

- 企业内部协作与审批。
- Salesforce / CRM 的深度集成。
- Win/loss interviews。
- 组织权限、SSO 和复杂治理。
- Revenue attribution。
- 完整的长期 change-detection / monitoring 平台（除非 MVP 后续确实实现）。

诚实限定范围比声称“一次替代整个 Klue/Crayon”更可信，也更符合比赛强调的 honest scoping。

---

## 6. Target 筛选条件

正式 kill target 必须同时满足：

| 条件 | 要求 |
|---|---|
| Public pricing | 必须有公开、可引用的价格 |
| 产品类型 | 面向人类使用的 SaaS |
| 核心 workflow | Competitor research / monitoring / battlecards |
| 价格 | 最好高于 `$50/month`，价格越高越利于叙事 |
| 可替代比例 | MVP 能端到端替代一个有意义的核心工作流 |
| Monid 单次成本 | 目标低于 `$1/report`，越低越好 |
| 可验证性 | 能用真实输入、真实来源和真实结果演示 |
| 可传播性 | 观众在 60–90 秒内能理解价格与结果差异 |

需要特别注意：Klue 等产品可用来理解专业 CI 工作流和市场价值，但如果官网只有 “Get a Demo / Talk to an Expert” 而没有公开购买价格，就不应作为比赛提交中的正式 target。对话中曾将 Klue/Crayon 类产品作为方向参照，最终 target 尚未确定。

对话还记录了 Klue 在 2026 年相关文章中给出的行业参考：专业 CI 平台企业部署常见约 `$15k–$40k+/year`。这只能用于说明该 workflow 的商业价值，不能替代比赛所需的目标产品公开定价证据。

---

## 7. MVP 架构

### 最小端到端链路

```text
INPUT: company / product pair
              ↓
      Query & source planner
              ↓
  ┌───────────┼─────────────┐
  ↓           ↓             ↓
Web/Pricing  Social/Reviews  News/Company
  └───────────┼─────────────┘
              ↓
     Evidence normalization
              ↓
      Deduplication + conflict detection
              ↓
        Claim generation
              ↓
     Claim verification + confidence
              ↓
       Battlecard synthesis
              ↓
  Report + evidence URLs + measured cost
```

### 推荐的数据对象

```text
Source
  - url
  - source_type
  - title
  - publisher
  - retrieved_at

Evidence
  - source_id
  - excerpt_or_fact
  - observed_at
  - topic
  - entity

Claim
  - statement
  - supporting_evidence_ids[]
  - contradicting_evidence_ids[]
  - confidence
  - strategic_implication

Run
  - input
  - endpoint_calls[]
  - successes / failures
  - source_count
  - elapsed_time
  - total_measured_cost
```

### MVP 输出

- Executive summary。
- Positioning / target customer。
- Pricing comparison。
- Feature comparison。
- Strengths and weaknesses。
- Customer love / complaints。
- Recent momentum / notable events。
- Competitive threats and recommended talking points。
- 每个重要 claim 对应的 evidence URL 与置信度。
- 本次运行使用的 APIs、调用次数、成功/失败数与总成本。

### 极简 UI

```text
┌─────────────────────────────────────┐
│ What should I compare?              │
│                                     │
│ HubSpot vs Salesforce               │
│                                     │
│              [ Kill it ]            │
└─────────────────────────────────────┘
```

运行过程中动态显示真实进度，例如：

```text
Searching official websites...
Reading reviews...
Analyzing Reddit discussions...
Finding pricing and product differences...
Checking recent news...
Reconciling conflicting claims...
```

最终显示：

```text
REPORT GENERATED
Sources: 126
APIs called: 14
Total measured cost: $0.083
```

数字只能来自真实运行，不能为了视频预先编造。

---

## 8. Demo / 视频叙事

最有力的叙事不是功能清单，而是价格与结果的直接对比。

建议结构：

1. 第一屏：正式 target 的公开价格，例如 `$149/month`。
2. 文案：`Your agent doesn't need another dashboard.`
3. 输入：`HubSpot vs Salesforce`。
4. 快速展示真实搜集进度与来源数量。
5. 展示带证据链接的 battlecard 和冲突 claim 的处理结果。
6. 最后一屏：

```text
SaaS: $149/month
Our agent: $0.42/run

We killed ______.
```

价格、来源数量、API 数和成本全部以最终实测为准。视频需要让观众看到的不只是“一份报告出现了”，还要看到报告为什么可信：证据、冲突处理、置信度和真实调用账单。

---

## 9. 决策记录

### 阶段 A：理解比赛

- 确认比赛核心是把一个传统 SaaS 的核心 workflow 重做为按次调用的 Agent-native service。
- 认识到选择一个昂贵、具体、有明显 before/after 的 workflow 比做大而全的产品更有胜算。

### 阶段 B：列出十个方向

- Sales Intelligence 综合得分最高。
- Competitive Intelligence 最适合在 10 天内做出强 demo，也贴合既有研究能力。
- Private Market Research 最适合赛后继续发展，但比赛期内更重。

### 阶段 C：选择 Competitive Intelligence

- 将产品收敛到 `Competitor Research → Evidence → Battlecard`。
- 核心护城河定为 evidence reconciliation，而不是 API 数量。

### 阶段 D：修正 target 策略

- 发现 Klue 等典型 CI 产品没有可直接引用的公开价格，不适合作为正式 kill target。
- 改为“先锁工作流，再找有公开价格、出售这一工作流的 SaaS”。

### 当前决策

- **方向已定：Agent-native Competitive Intelligence / Battlecard API。**
- **正式 kill target 未定。**
- **Monid endpoint 组合与真实成本未定，必须通过 catalog 与实际调用确认。**

---

## 10. 立即执行的两项工作

### 工作 1：确定正式 SaaS target

建立候选清单并逐个记录：

- 产品名和官网。
- 公开价格页面及截图/存档。
- 哪个具体 workflow 被替代。
- 该 workflow 在产品价值中的重要性。
- MVP 可替代与不可替代的边界。
- 价格冲击力和 90 秒视频可讲性。

输出：一张 target comparison 表和唯一推荐 target。

### 工作 2：确认 Monid endpoints 与单次成本

围绕 MVP 的每一个信息需求执行：

```text
discover → inspect schema → test run → record cost/latency/quality
```

至少确认：

- 官网、产品与 pricing 页面检索/抓取。
- Competitor discovery。
- 实时 news。
- Reddit / YouTube / reviews 等公开反馈源。
- Company / LinkedIn 类信号是否必要且可稳定获得。
- 每个 endpoint 的 schema、限制、单价、失败成本和响应质量。

输出：最终 endpoint map、降级策略、预估调用预算，以及至少一次完整真实 run 的 measured cost。

---

## 11. 开发前必须回答的验收问题

- 正式 target 是否存在当前、公开、可引用的价格？
- 我们替代的是否是一个完整 workflow，而不是单次搜索或摘要？
- 是否至少有多个 Monid endpoint 对最终结果产生不可替代的贡献？
- 所有核心 claim 是否能回溯到真实 evidence URL？
- 冲突来源是否被显式处理，而不是被模型静默忽略？
- 是否记录每次调用（包括失败调用）的真实成本？
- demo 能否在 60–90 秒内让陌生观众理解 input、output、可信度和价格差？
- 是否保留了比赛期间新增 Monid integration 的清楚 Git commit history？
- 是否把足够时间留给视频、发布与多平台传播？

---

## 12. 来源与可信度说明

本文件是对原始 ChatGPT 对话的结构化整理，不是官方规则的替代品。对话中的网页引用标记属于当时会话环境，迁移后无法作为稳定证据使用，因此没有原样保留。所有会影响参赛资格、定价比较和成本声明的内容，都应在执行相应工作时重新打开官方页面或供应商价格页验证，并保存可复查链接或截图。

权威入口：

- Monid “We Kill” Hackathon：https://hacks.monid.ai/

