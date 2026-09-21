# MODEL SOURCE OF TRUTH — 先读这一份 / Read this first

**更新 Update:** 2026-09-21 · **产品 Product:** Season Tackle v5 (addon tools for OBM users)

---

## 0. 30 秒版 The 30-second version

> 客户是**马来西亚渔具进口 + 部分自制 + 批发 + 网店**的公司。
> **OBM 会计软件继续用**（法律账本、发票、税、AR）。
> 我们要建的是一套 **addon tools**：让 **外勤 8 人、内勤 3 人、仓库** 做事更顺。
> 真实代码在 **`F:\season takle webapp\backend` + `\frontend`** —— **加强它，不要重写**。

---

## 1. 唯一施工依据 Single build pack

```
F:\season takle webapp\season takle v5 unified\
  00-ARBITER-INDEX.md              ← 法 G1–G16 + 编号登记 + 决策日志 + 阅读顺序（先读这份）
  01-CANONICAL-MODEL.md            ← 数学本体：四桶/ATP、lot→SKU、Φ 守恒、信用、DO、保修两层、
                                      迁移 E87 出生证明、验收算例、I-68…I-109 登记
  02-VERIFIED-BUGS-P0-FIXES.md     ← 11 个**代码级已验证**的真 bug（file:line）+ 14 天 P0 计划 + CI 门
  03-DIALOGUES-AND-SCENARIOS-ADDENDUM.md ← v5 新增 12 幕对话 + 24 条场景 + 中英文案库
  04-HANDOVER-PROMPT.md            ← 开新对话时直接复制的提示词 + 完成定义 + 试点计划
```

## 2. 其余四包的角色 Roles of the other packs

| 包 | 角色 | 怎么用 |
|---|---|---|
| `season takle v1\` | **AS-IS 证据库 + 场景/对话全集** | 读 04（表/API/权限）、01（E1–E82/I-1–I-47）、06（I-48–I-67）、02（100 场景）、03（13 幕对话）。**它的 TO-BE 清单已被 unified 包取代** |
| `season takle v5 model\` | MiMo 的模型（三态命名/迁移 E6/lot 层的来源） | 观点可借；**编号与 unified 冲突，以 unified 为准** |
| `kimi k3 review\` | 代码级审查（8 个 bug 的首次发现） | 02 文件已吸收并复验；背景阅读 |
| `xiaomi mimo xpro review\` | 元审查（20 个双方都漏的洞、文档仲裁协议） | 背景阅读；unified 00 §2 的权威顺序来自这里 |
| `season takle from google flash\` | 业务批判（lot 层、三态、信用分级、落地成本、现场对话） | **只取想法，不取 schema**（它有误读代码与假设 OBM 字段的问题） |

## 3. 冲突时怎么办 When documents conflict

```
1. 真实代码 AS-IS（但代码本身可能有 bug —— 看 unified 02）
2. unified 00 的 G1–G16 + 有测试的不变量
3. unified 01（TO-BE 数学）
4. 其他包的评论
5. 老板的口头决定 ⇒ 记进 unified 00 §10 决策日志，覆盖以上（法律/合规除外）
```
**记住三条**：① OBM 只读 ② 一个数量只有一个写入口（现在网店在绕过它）③ AI 只提案，人过账。

## 4. 立刻要做的三件事（不论谁接手）

```
① 读 unified 04 的提示词 → 新开一段对话给 AI
② 先修 unified 02 的 B1（网店扣库存绕过账本）—— 这是正在跑的漏洞，不是理论
③ 让客户交 8 样东西（unified 04 §5），尤其**一份真实的 OBM 销售样本**，
   否则对账功能只能标「实验性」（G15）
```
