"use client";

// 工作台页（PRD 3.2）：左栏材料+对话迭代，右栏 iframe 产物预览；门禁步骤条+版本历史+导出+过门
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  getSession,
  listProjects,
  listVersions,
  addVersion,
  updateProjectGates,
  updateProjectMaterials,
  recordJudgment,
  type Gate,
  type Project,
  type Version,
} from "@/lib/storage";
import { GATE_META, SAMPLE_PRD, SAMPLE_DIFF } from "@/lib/prompts";

const GATES: Gate[] = ["g1", "g2", "g3"];

// 软门禁：每道门的上游门，用于跳门干预与跨门上下文
const prevGateOf = (g: Gate): Gate | null => (g === "g2" ? "g1" : g === "g3" ? "g2" : null);

// 版本显示名：vN（N=该门内正序版本号）
const versionLabel = (list: Version[], vid: string | null): string => {
  if (!vid) return "";
  const idx = list.findIndex((x) => x.id === vid);
  return idx >= 0 ? `v${list.length - idx}` : "历史版本";
};

export default function WorkspacePage() {
  const params = useParams();
  const router = useRouter();
  const id = typeof params.id === "string" ? params.id : "";

  const [project, setProject] = useState<Project | null>(null);
  const [gate, setGate] = useState<Gate>("g1");
  const [materials, setMaterials] = useState("");
  const [instruction, setInstruction] = useState("");
  const [currentHtml, setCurrentHtml] = useState("");
  const [currentVersionId, setCurrentVersionId] = useState<string | null>(null);
  const [versions, setVersions] = useState<Version[]>([]);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [pendingVerdict, setPendingVerdict] = useState<null | "conditional" | "reject">(null);
  const [verdictNote, setVerdictNote] = useState("");
  const [saveWarn, setSaveWarn] = useState(""); // 本地存储写入失败的显性提示

  // 载入项目 + demo 预填示例 PRD
  useEffect(() => {
    const session = getSession();
    if (!session) {
      router.replace("/login");
      return;
    }
    const found = listProjects(session.username).find((x) => x.id === id) ?? null;
    if (!found) {
      router.replace("/");
      return;
    }
    let p = found;
    // 示例项目：对应门材料为空时预填示例材料并持久化（从属项目，刷新不丢）
    // G2 刻意不预填——留空生成=跨门上下文卖点的现场演示
    if (new URLSearchParams(window.location.search).get("demo") === "1") {
      const m = { ...p.materials };
      let changed = false;
      if (!(m.g1 ?? "").trim()) {
        updateProjectMaterials(p.id, "g1", SAMPLE_PRD);
        m.g1 = SAMPLE_PRD;
        changed = true;
      }
      if (!(m.g3 ?? "").trim()) {
        updateProjectMaterials(p.id, "g3", SAMPLE_DIFF);
        m.g3 = SAMPLE_DIFF;
        changed = true;
      }
      if (changed) p = { ...p, materials: m };
    }
    setProject(p);
    setVersions(listVersions(p.id));
  }, [id, router]);

  // 切门：加载该门已过门产物（未过门则清空工作台）
  useEffect(() => {
    if (!project) return;
    const vid = project.gates[gate];
    const v = vid ? versions.find((x) => x.id === vid) : undefined;
    setCurrentHtml(v?.html ?? "");
    setCurrentVersionId(v?.id ?? null);
    setMaterials(project.materials?.[gate] ?? ""); // 材料从属项目×门禁，切门即载
    setInstruction("");
    setError("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gate, project?.id]);

  const gateVersions = versions.filter((v) => v.gate === gate).slice().reverse();

  const generate = async () => {
    if (!project || generating) return;
    // 跨门上下文（PRD 4.1）：G2/G3 自动携带上一道门已过门产物
    const prevGate = prevGateOf(gate);
    let gateContextHtml = "";
    if (prevGate && project.gates[prevGate]) {
      const v = versions.find((x) => x.id === project.gates[prevGate]);
      if (v) gateContextHtml = v.html;
    }
    // G2 材料面板承诺「可留空，默认基于 Gate1 测试点设计用例」——
    // G1 已过门时放行空材料空指令（此前被校验拦截，核心差异化路径在自家门口断掉）
    const autoFromContext = gate === "g2" && !!gateContextHtml && !currentHtml;
    if (!materials.trim() && !instruction.trim() && !autoFromContext) {
      setError("请先输入需求材料（或点「加载示例 PRD」），迭代时输入修改指令");
      return;
    }
    const effectiveInstruction =
      instruction.trim() ||
      (currentHtml
        ? "在保持既有结构下优化细节"
        : autoFromContext
          ? "基于上一道门评审报告提取的测试点，生成初版测试用例集"
          : "首次生成");
    setGenerating(true);
    setError("");
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-gk-guard": process.env.NEXT_PUBLIC_GK_GUARD ?? "", // 接口防护
        },
        body: JSON.stringify({
          gate,
          materials: materials.trim(),
          instruction: effectiveInstruction,
          previousHtml: currentHtml || undefined,
          gateContextHtml: gateContextHtml || undefined,
        }),
      });
      const data = (await res.json()) as { html?: string; error?: string };
      if (!res.ok || !data.html) throw new Error(data.error || `HTTP ${res.status}`);
      setCurrentHtml(data.html);
      // 写后查——版本存盘失败必须显性提示，不许「界面像存了、刷新就没」
      const v = addVersion(project.id, {
        gate,
        instruction: effectiveInstruction,
        html: data.html,
      });
      if (!v) {
        setSaveWarn(
          "产物已生成，但版本存盘失败（本地存储可能已满）——刷新将丢失该产物，请立即「导出 HTML」备份"
        );
        setCurrentVersionId(null);
      } else {
        setCurrentVersionId(v.id);
        setVersions(listVersions(project.id));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "生成失败，请重试");
    } finally {
      setGenerating(false);
    }
  };

  // 三态判定（PRD 第2节闭环）：通过/有条件通过=锁版过门；打回=不锁版、留痕意见、线下流转后迭代重审
  // 已过门的门再判定必须确认（改锁/解锁不许静默发生）；判定与锁状态强制同步
  const judge = (verdict: "pass" | "conditional" | "reject", note: string) => {
    if (!project || !currentVersionId) return;
    const locked = project.gates[gate];
    if (verdict === "reject" && locked) {
      if (
        !window.confirm(
          `该门已过门（锁定 ${versionLabel(gateVersions, locked)}）。打回将解除锁定，后续门禁将失去跨门上下文。确认打回？`
        )
      )
        return;
    } else if (locked && locked !== currentVersionId) {
      if (
        !window.confirm(
          `该门已过门（锁定 ${versionLabel(gateVersions, locked)}），当前预览为 ${versionLabel(
            gateVersions,
            currentVersionId
          )}。继续判定将把锁定版本改为当前版。继续？`
        )
      )
        return;
    }
    const j = { verdict, note, versionId: currentVersionId, at: new Date().toISOString() };
    // 判定三态与锁状态同步：通过/有条件→锁当前版；打回→解锁（PRD 第2节「打回不过门不锁版」在重判场景同样成立）
    const gates = { ...project.gates, [gate]: verdict === "reject" ? null : currentVersionId };
    const okJ = recordJudgment(project.id, gate, j);
    const okG = updateProjectGates(project.id, gates);
    if (!okJ || !okG) {
      // 判定存盘失败显性提示，不再「页面变绿实际没存」
      setSaveWarn("判定存盘失败（本地存储写入异常）——本次判定未留痕，请重试或导出产物备份");
      return;
    }
    const updated: Project = { ...project, judgments: { ...project.judgments, [gate]: j }, gates };
    setProject(updated);
    setPendingVerdict(null);
    setVerdictNote("");
    if (verdict === "reject") {
      window.alert(
        "已记录打回判定与意见（版本留痕、同步解锁）。闭环指引：「导出 HTML」把产物+判定记录发材料方 → 修改后粘贴新材料 → 「迭代」重新生成 → 再判定。"
      );
      return;
    }
    const next: Gate | null = gate === "g1" ? "g2" : gate === "g2" ? "g3" : null;
    if (next) {
      setGate(next);
    } else {
      window.alert(
        "🎉 三道门禁判定完成！可逐门导出产物 HTML（自动附平台判定记录）；《左移质量报告》汇总导出见扩展规划 P1-1。"
      );
    }
  };

  // 导出附「平台判定记录」区块——PRD 第2节「有条件通过意见导出存档可见」
  // 「打回=导出意见报告线下流转」的落地：意见随文件走，线下闭环才有载体
  const escapeHtml = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const withJudgment = (html: string): string => {
    if (!project) return html;
    const j = project.judgments?.[gate];
    if (!j) return html;
    const label =
      j.verdict === "pass" ? "✓ 通过" : j.verdict === "conditional" ? "△ 有条件通过" : "✗ 打回";
    const color = j.verdict === "pass" ? "#059669" : j.verdict === "conditional" ? "#d97706" : "#dc2626";
    const block =
      `<div style="margin:24px 16px;padding:12px 16px;border:1px solid ${color};border-left:4px solid ${color};` +
      `border-radius:8px;background:#fff;font:13px/1.8 system-ui,'Microsoft YaHei',sans-serif;color:#334155">` +
      `<b style="color:${color}">GateKeeper 平台判定记录：${label}</b>` +
      (j.note ? `<br>判定意见：${escapeHtml(j.note)}` : "") +
      `<br><span style="color:#94a3b8">判定时间：${new Date(j.at).toLocaleString("zh-CN")} · 产物版本：${versionLabel(
        gateVersions,
        j.versionId
      )} · 本区块由平台导出时自动附加</span></div>`;
    if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, `${block}</body>`);
    return html + block;
  };

  const exportHtml = () => {
    if (!currentHtml || !project) return;
    // 文件名带版本号+时间戳，多版本导出互不覆盖（回滚对照场景不翻车）
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
    const blob = new Blob([withJudgment(currentHtml)], { type: "text/html;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${project.name}-${gate}-${versionLabel(gateVersions, currentVersionId) || "草稿"}-${stamp}.html`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const rollback = (v: Version) => {
    setCurrentHtml(v.html);
    setCurrentVersionId(v.id); // 回滚=指针移动；继续迭代将产生新版本（PRD 3.3）
  };

  // 软门禁：跳未过门的后续门→知情确认；工具管干预+留痕，跳不跳是人的决定
  const gotoGate = (g: Gate) => {
    if (!project) return;
    const prev = prevGateOf(g);
    if (prev && !project.gates[prev]) {
      if (
        !window.confirm(
          `上游「${GATE_META[prev].label}」尚未过门，「${GATE_META[g].label}」生成时将缺少跨门上下文（上一门产物），产物质量会下降。仍要进入？`
        )
      )
        return;
    }
    setGate(g);
  };

  if (!project) return null;
  const meta = GATE_META[gate];

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-white border-b border-slate-200 px-4 py-3 flex items-center gap-3 flex-wrap">
        <button className="text-sm text-slate-500 hover:text-indigo-600" onClick={() => router.push("/")}>
          ← 项目
        </button>
        <span className="font-semibold text-sm truncate max-w-[12rem]">{project.name}</span>
        <nav className="flex items-center gap-1 ml-auto flex-wrap">
          {GATES.map((g, i) => (
            <span key={g} className="flex items-center">
              {i > 0 && <span className="text-slate-300 mx-1">─</span>}
              <button
                onClick={() => gotoGate(g)}
                className={`text-xs px-3 py-1.5 rounded-full border whitespace-nowrap ${
                  gate === g
                    ? "bg-indigo-600 text-white border-indigo-600"
                    : project.judgments?.[g]?.verdict === "reject"
                      ? "bg-red-50 text-red-500 border-red-200 hover:bg-red-100"
                      : project.judgments?.[g]?.verdict === "conditional"
                        ? "bg-amber-50 text-amber-600 border-amber-200 hover:bg-amber-100"
                        : project.gates[g]
                          ? "bg-emerald-50 text-emerald-600 border-emerald-200 hover:bg-emerald-100"
                          : "bg-white text-slate-400 border-slate-200 hover:text-slate-600"
                }`}
              >
                {project.judgments?.[g]?.verdict === "reject"
                  ? "✗ "
                  : project.judgments?.[g]?.verdict === "conditional"
                    ? "△ "
                    : project.gates[g]
                      ? "✓ "
                      : ""}
                {GATE_META[g].label}
              </button>
            </span>
          ))}
        </nav>
      </header>

      <main className="flex-1 grid grid-cols-1 lg:grid-cols-5 gap-4 p-4">
        {saveWarn && (
          <div className="lg:col-span-5 text-xs bg-amber-50 border border-amber-300 text-amber-700 rounded-lg px-3 py-2">
            ⚠ {saveWarn}
          </div>
        )}
        {/* 左栏：材料 + 对话迭代 + 版本历史 */}
        <section className="lg:col-span-2 flex flex-col gap-3">
          <div className="bg-white rounded-xl shadow p-4">
            <h2 className="text-xs font-semibold text-slate-500 mb-2">📄 材料面板 · {meta.short}</h2>
            <textarea
              className="w-full h-40 border border-slate-300 rounded-lg p-3 text-xs font-mono resize-y focus:outline-none focus:border-indigo-400"
              placeholder={meta.materialPlaceholder}
              value={materials}
              onChange={(e) => {
                setMaterials(e.target.value);
                // 从属层级：材料即输即存；存盘失败显性提示
                if (!updateProjectMaterials(project.id, gate, e.target.value))
                  setSaveWarn("本地存储写入失败（可能已满）——材料/判定/版本可能未保存，建议导出重要产物备份");
              }}
            />
            <div className="flex justify-between items-center mt-2 text-xs text-slate-400">
              <span className={materials.length > 4000 ? "text-red-500" : ""}>
                {materials.length}/4000 字{materials.length > 4000 ? "（超长将截断）" : ""}
              </span>
              <span className="flex gap-3">
                <button
                  className="hover:text-slate-600"
                  onClick={() => {
                    setMaterials("");
                    updateProjectMaterials(project.id, gate, "");
                  }}
                >
                  清空
                </button>
                <button
                  className="text-indigo-500 hover:underline"
                  onClick={() => {
                    setMaterials(SAMPLE_PRD);
                    updateProjectMaterials(project.id, gate, SAMPLE_PRD);
                  }}
                >
                  加载示例 PRD
                </button>
              </span>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow p-4">
            <h2 className="text-xs font-semibold text-slate-500 mb-2">💬 生成与迭代</h2>
            <div className="flex gap-2">
              <input
                className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-400"
                placeholder={currentHtml ? "迭代指令，如：补充安全类用例" : "可留空，直接生成"}
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !generating) generate();
                }}
              />
              <button
                className="bg-indigo-600 text-white rounded-lg px-4 py-2 text-sm hover:bg-indigo-700 disabled:opacity-50 whitespace-nowrap"
                disabled={generating}
                onClick={generate}
              >
                {generating ? "生成中…" : currentHtml ? "迭代" : "🚀 生成"}
              </button>
            </div>
            {error && <p className="mt-2 text-xs text-red-500 bg-red-50 rounded p-2">⚠ {error}</p>}
            <p className="mt-2 text-xs text-slate-400">
              {generating ? "AI 正在生成产物…（实测约 1 分钟；150s 超时自动熔断）" : `当前门版本数：${gateVersions.length}`}
            </p>
          </div>

          <div className="bg-white rounded-xl shadow p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold text-slate-500">🕘 {meta.short}产物 · 版本历史（延展能力①）</h2>
              <button className="text-xs text-indigo-500 hover:underline" onClick={() => setShowHistory((s) => !s)}>
                {showHistory ? "收起" : "展开"}
              </button>
            </div>
            {showHistory && (
              <ul className="mt-2 space-y-1">
                {gateVersions.length === 0 && <li className="text-xs text-slate-400">暂无版本</li>}
                {gateVersions.map((v, idx) => (
                  <li
                    key={v.id}
                    className={`flex items-center gap-2 text-xs rounded px-2 py-1.5 cursor-pointer ${
                      v.id === currentVersionId ? "bg-indigo-50 text-indigo-700" : "hover:bg-slate-50"
                    }`}
                    onClick={() => rollback(v)}
                  >
                    <span className="font-mono">v{gateVersions.length - idx}</span>
                    <span className="truncate flex-1">{v.instruction}</span>
                    <span className="text-slate-400">{new Date(v.createdAt).toLocaleTimeString("zh-CN")}</span>
                    {v.id === currentVersionId && <span>←当前</span>}
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-xs text-slate-400">点击版本=回滚预览到该版；继续迭代将产生新版本</p>
          </div>
        </section>

        {/* 右栏：产物预览 */}
        <section className="lg:col-span-3 flex flex-col gap-3">
          {/* 软门禁：上游未过门时常驻警示，跨门上下文缺失必须让用户知情 */}
          {prevGateOf(gate) && !project.gates[prevGateOf(gate)!] && (
            <div className="text-xs bg-amber-50 border border-amber-200 text-amber-700 rounded-lg px-3 py-2 flex items-center gap-2 flex-wrap">
              ⚠ 上游「{GATE_META[prevGateOf(gate)!].label}」尚未过门，本门生成将缺少跨门上下文（上一门产物）。
              <button className="underline hover:text-amber-900" onClick={() => setGate(prevGateOf(gate)!)}>
                返回{GATE_META[prevGateOf(gate)!].short}
              </button>
            </div>
          )}
          {/* 当前门判定留痕可见——意见存了就必须看得到 */}
          {project.judgments?.[gate] && (
            <div
              className={`text-xs border rounded-lg px-3 py-2 ${
                project.judgments[gate]!.verdict === "pass"
                  ? "bg-emerald-50 border-emerald-200 text-emerald-700"
                  : project.judgments[gate]!.verdict === "conditional"
                    ? "bg-amber-50 border-amber-200 text-amber-700"
                    : "bg-red-50 border-red-200 text-red-700"
              }`}
            >
              当前门判定：
              <b>
                {project.judgments[gate]!.verdict === "pass"
                  ? "✓ 通过"
                  : project.judgments[gate]!.verdict === "conditional"
                    ? "△ 有条件通过"
                    : "✗ 打回"}
              </b>
              · {versionLabel(gateVersions, project.judgments[gate]!.versionId)} ·{" "}
              {new Date(project.judgments[gate]!.at).toLocaleString("zh-CN")}
              {project.judgments[gate]!.note ? ` · 意见：${project.judgments[gate]!.note}` : ""}
              {project.judgments[gate]!.versionId !== currentVersionId
                ? "（针对非当前预览版本，重新判定将更新）"
                : ""}
            </div>
          )}
          <div className="flex gap-2 flex-wrap">
            <button
              className="text-xs bg-white border border-slate-300 rounded-lg px-3 py-1.5 hover:bg-slate-50 disabled:opacity-40"
              disabled={generating}
              onClick={generate}
            >
              ↻ 重新生成
            </button>
            <button
              className="text-xs bg-white border border-slate-300 rounded-lg px-3 py-1.5 hover:bg-slate-50 disabled:opacity-40"
              disabled={!currentHtml}
              onClick={exportHtml}
            >
              ⬇ 导出 HTML（延展能力②）
            </button>
            {pendingVerdict === null ? (
              <span className="ml-auto flex gap-2 items-center">
                <button
                  className="text-xs bg-white border border-red-300 text-red-500 rounded-lg px-3 py-1.5 hover:bg-red-50 disabled:opacity-40"
                  disabled={!currentVersionId}
                  onClick={() => setPendingVerdict("reject")}
                >
                  ✗ 打回
                </button>
                <button
                  className="text-xs bg-white border border-amber-300 text-amber-600 rounded-lg px-3 py-1.5 hover:bg-amber-50 disabled:opacity-40"
                  disabled={!currentVersionId}
                  onClick={() => setPendingVerdict("conditional")}
                >
                  △ 有条件通过
                </button>
                <button
                  className="text-xs bg-emerald-600 text-white rounded-lg px-3 py-1.5 hover:bg-emerald-700 disabled:opacity-40"
                  disabled={!currentVersionId}
                  onClick={() => judge("pass", "")}
                >
                  ✓ 通过{gate === "g1" ? " → G2" : gate === "g2" ? " → G3" : ""}
                </button>
              </span>
            ) : (
              <span className="ml-auto flex gap-2 items-center">
                <input
                  className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs w-64 focus:outline-none focus:border-indigo-400"
                  placeholder={pendingVerdict === "reject" ? "打回意见（随版本留痕）" : "有条件通过备注（随版本留痕）"}
                  value={verdictNote}
                  onChange={(e) => setVerdictNote(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") judge(pendingVerdict, verdictNote.trim());
                  }}
                />
                <button className="text-xs bg-indigo-600 text-white rounded-lg px-3 py-1.5 hover:bg-indigo-700" onClick={() => judge(pendingVerdict, verdictNote.trim())}>
                  确认记录
                </button>
                <button className="text-xs text-slate-400 hover:text-slate-600" onClick={() => { setPendingVerdict(null); setVerdictNote(""); }}>
                  取消
                </button>
              </span>
            )}
          </div>
          <div className="flex-1 bg-white rounded-xl shadow overflow-hidden min-h-[28rem] relative">
            {currentHtml ? (
              <iframe
                title="产物预览"
                sandbox="allow-scripts allow-downloads allow-modals"
                srcDoc={currentHtml}
                className="w-full h-full min-h-[28rem] border-0"
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-slate-300 text-sm p-8 text-center">
                {generating ? "AI 正在生成产物…" : "产物预览区 —— 左侧输入材料后点击「🚀 生成」"}
              </div>
            )}
            {generating && currentHtml && (
              <div className="absolute inset-0 bg-white/60 flex items-center justify-center text-sm text-indigo-600">
                AI 正在迭代产物…
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
