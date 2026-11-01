// GateKeeper 门禁角色包（PRD 3.4 产物骨架硬约束 + 4.1 跨门上下文）
import type { Gate } from "./storage";

// 示例 PRD（PRD 4.4：预埋 7 缺陷，其中⑦=图片占位应列入"无法评审项"）
export const SAMPLE_PRD = `需求：优惠券领取功能
用户在活动页可以领取优惠券，页面交互见【图1：领券页原型图（文字演示略）】。领券成功后在"我的优惠券"中可以看到。优惠券有使用门槛和有效期。活动很火爆，要保证用户体验，页面加载要快。每个用户都可以领取优惠券，领了就能用。如果出现问题联系运营同学处理。`;

// 示例提测材料（G3 demo：与 SAMPLE_PRD 同一故事线的代码改动，预埋多处质量缺陷供评审检出）
export const SAMPLE_DIFF = `改动说明：领券功能重构——receiveCoupon 从活动主流程拆为独立接口，接入新券库存服务。

--- a/src/coupon/controller/CouponController.java
+++ b/src/coupon/controller/CouponController.java
@@ -45,6 +45,28 @@ public class CouponController {
+    @PostMapping("/api/coupon/receive")
+    public Result receiveCoupon(@RequestBody ReceiveReq req) {
+        try {
+            CouponInfo coupon = couponService.getById(req.getCouponId());
+            if (coupon == null) {
+                return Result.fail("券不存在");
+            }
+            userCouponMapper.insert(new UserCoupon(req.getUserId(), req.getCouponId()));
+            accountService.addBalance(req.getUserId(), req.getAmount());
+            if (System.currentTimeMillis() >= coupon.getExpireAt()) {
+                return Result.fail("券已过期");
+            }
+            stockService.decrease(req.getCouponId());
+            return Result.ok();
+        } catch (Exception e) {
+            log.info("receive coupon error");
+            return Result.ok();
+        }
+    }`;

export const GATE_META: Record<Gate, { label: string; short: string; materialPlaceholder: string }> = {
  g1: {
    label: "Gate 1 · 需求评审",
    short: "需求评审",
    materialPlaceholder: "粘贴 PRD / 需求文档文本（≤4000 字；表格可直接粘贴文本形态；图片用【图N：说明】占位）…",
  },
  g2: {
    label: "Gate 2 · 用例左移",
    short: "用例左移",
    materialPlaceholder: "补充材料（可留空，默认基于 Gate 1 报告提取的测试点设计用例）…",
  },
  g3: {
    label: "Gate 3 · 提测准入",
    short: "提测准入",
    materialPlaceholder: "粘贴代码 diff 或改动说明…",
  },
};

const COMMON = `产物硬性约束：
- 输出一个完整的、自包含的单文件 HTML 页面：以 <!DOCTYPE html> 开头，CSS 用 <style> 内联，JS 用 <script> 内联，禁止任何外部依赖（无 CDN、无外链字体/图片）
- 界面为简体中文；浅色底、卡片式布局、圆角、系统字体（font-family: system-ui, "Microsoft YaHei", sans-serif），视觉专业干净
- 页面运行在沙箱 iframe 中（无同源权限）：禁止使用 localStorage/sessionStorage/cookie/fetch；alert/confirm、文件下载（Blob + a[download]）可用
- 页面内交互（勾选/筛选/输入/统计联动）用原生 JS 实现，必须真实可用，不是摆设
- 页面主标题下方加一行灰色小字说明：「页内勾选与填写供离线评审使用，正式判定留痕以 GateKeeper 平台判定面板为准」——产物内判定与平台判定是双轨：导出后离线流转用页内勾选，平台内正式留痕用判定面板
- 只输出 HTML 代码本身，不要任何解释文字，不要 markdown 代码块标记
- 体量紧凑：聚焦必备区块，全文控制在约 300 行以内，不堆装饰性内容（体量直接决定生成时延与截断风险）`;

const G1_ROLE = `角色：资深测试架构师，主持需求评审门禁（测试左移第一道门）。
基于用户提供的需求材料，生成《需求质量评审报告》交互页面，必须按以下区块顺序完整输出：
① 总体评估：可测性评分（1-5 星，实心/空心星渲染）+ 一句话结论
② 模糊点清单：表格三列（原文引用 | 问题 | 建议改写）
③ 缺失项清单：表格三列（缺失项 | 类别[边界/异常流/验收标准] | 建议补充）
④ 测试点提取：编号列表，覆盖已发现问题与正常/边界/异常场景（供下一道门设计用例）
⑤ 无法评审项：材料中【图N】占位符等 AI 不可见内容逐条列出，标注"需评审人对照原件人工确认"——严禁假装评审过图片内容，看不见就是看不见
⑥ 评审结论勾选单：通过/有条件通过/打回 三选一（radio）+ 评审意见 textarea + ②③⑤每条问题一个可勾选确认的 checkbox`;

const G2_ROLE = `角色：测试设计专家，执行用例左移门禁（第二道门）。
基于上一道门评审报告中的测试点（及用户补充材料），生成《测试用例集》交互页面：
① 顶部统计条：用例总数、P0/P1/P2 数量、已勾选数——随筛选联动更新
② 筛选器：按模块、按优先级、按执行状态（下拉或标签组）
③ 用例表格七列：编号(TC-01 起)/模块/前置条件/步骤/预期结果/优先级(P0-P2)/执行状态（未执行·通过·失败·阻塞，点击循环切换并变色）
④ 每行行首 checkbox 可勾选
⑤ 「导出 CSV」按钮：把当前筛选条件下的用例表导出为 .csv 文件——拼接 CSV 文本时前置 BOM（﻿）防 Excel 打开中文乱码，用 Blob + a[download] 实现下载。这是用例数据流向 Excel/用例管理平台（禅道/TAPD 可导入 CSV）的通道，必须真实可用
用例设计要求：覆盖正常/边界/异常三类；步骤具体可执行；预期结果可判定（有数字/状态/文案，拒绝"正常显示"式空话）。
若用户提供了当前版本 HTML 与修改指令：在保持既有结构与已有用例的基础上按指令修改，输出完整新版本。`;

const G3_ROLE = `角色：提测准入审查员+代码质量评审专家，执行提测准入门禁（第三道门）。
定位：只做语义级审查（幂等/事务/异常语义/业务逻辑/安全语义），不替代 ESLint/Sonar 等规范扫描工具——工具管规范，AI 管语义，人管判定。
基于用户提供的代码 diff/完整代码/改动说明（及上一道门产物），生成《提测准入检查单》交互页面：
① 改动理解摘要：3-5 句话说清改了什么、影响面、主要风险面
② 六维质量评审表——每维一行：维度 | 评分(0-10) | 发现的问题（必须引用具体代码行/片段）| 改进建议：
   1.正确性（业务逻辑/边界条件/状态处理）
   2.健壮性（异常处理·禁止吞异常/幂等/事务与并发/资源释放）
   3.安全性（注入/越权/敏感信息硬编码/输入校验）
   4.可维护性（命名/复杂度/重复/兼容性破坏）
   5.可观测性（日志/错误码/监控埋点）
   6.兼容性（接口契约/数据库变更/上下游影响）
③ 风险提示列表：按严重度排序（高/中/低标签），每条附"建议验证方式"
④ 冒烟用例建议：3-5 条，含步骤与预期结果，测试可直接执行
⑤ 准入结论：显示综合评分（六维平均，正确性/健壮性/安全三维加权×1.5）+ 建议映射（≥8 建议通过 / 6-7.9 建议有条件通过 / <6 建议打回）；最终判定三选一 radio（通过/有条件通过/打回，人可覆盖 AI 建议）+ 意见栏
材料不足以判断的维度，如实标"无法判断"并说明缺什么材料——严禁臆断、严禁编造代码行。`;

/** 跨门上下文供信息提取用：先剥离 style/script/标签转纯文本再截断。
 *  单文件产物的 <style>/<script> 头部会吃光 8000 字预算，导致 LLM 看不到评审报告正文
 *  （实测缺陷：G1 过门后 G2 留空生成出空用例集）。信息提取场景不需要 HTML 结构。 */
function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

export function buildPrompts(input: {
  gate: Gate;
  materials: string;
  instruction: string;
  previousHtml?: string;
  gateContextHtml?: string;
}): { system: string; user: string } {
  const role = input.gate === "g1" ? G1_ROLE : input.gate === "g2" ? G2_ROLE : G3_ROLE;
  const system = `${role}\n\n${COMMON}`;

  const parts: string[] = [];
  if (input.gateContextHtml) {
    parts.push(
      `【上一道门禁产物内容（已转纯文本；只从中提取所需信息，如测试点清单；不要重复评审它）】\n${htmlToText(input.gateContextHtml).slice(0, 8000)}`
    );
  }
  if (input.materials.trim()) {
    parts.push(`【需求材料】\n${input.materials.trim().slice(0, 4000)}`);
  }
  if (input.previousHtml) {
    // 迭代产物兜底截断，防止生成物异常膨胀时 token 爆炸/超时放大
    parts.push(`【当前版本产物 HTML（在此基础上迭代）】\n${input.previousHtml.slice(0, 20000)}`);
  }
  parts.push(`【本轮指令】\n${input.instruction}`);
  return { system, user: parts.join("\n\n") };
}
