"use client";

// 首页 · 我的质量项目（PRD 3.1 · schema v2：卡片显示 材料/产物/版本 从属计数）
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  getSession,
  clearSession,
  listProjects,
  createProject,
  deleteProject,
  listVersions,
  type Project,
  type Session,
} from "@/lib/storage";

const GATE_DOTS = ["g1", "g2", "g3"] as const;
const DEMO_NAME = "优惠券功能重构（示例）";

export default function Home() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [session, setSessionState] = useState<Session | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [name, setName] = useState("");

  useEffect(() => {
    const s = getSession();
    if (!s) {
      router.replace("/login");
      return;
    }
    setSessionState(s);
    setProjects(listProjects(s.username));
    setReady(true);
  }, [router]);

  const user = session?.username ?? "";

  const refresh = () => {
    if (user) setProjects(listProjects(user));
  };

  const logout = () => {
    clearSession();
    router.replace("/login");
  };

  const openProject = (id: string, demo?: boolean) =>
    router.push(demo ? `/workspace/${id}?demo=1` : `/workspace/${id}`);

  const newProject = () => {
    if (!user) return;
    const n = name.trim();
    if (!n) {
      // 空项目名不再静默失败：按钮点了没反应=无反馈断裂，必须给提示
      window.alert("请先在输入框填写项目名称，再点「新建质量项目」");
      return;
    }
    const p = createProject(user, n);
    if (!p) {
      window.alert("创建项目失败：本地存储写入失败（可能已满）"); // 写失败显性提示
      return;
    }
    setName("");
    refresh();
    openProject(p.id);
  };

  // 示例项目去重：连点三次不该得到三个重复卡片
  const loadDemo = () => {
    if (!user) return;
    const existing = projects.find((p) => p.name === DEMO_NAME);
    if (existing) {
      openProject(existing.id, true);
      return;
    }
    const p = createProject(user, DEMO_NAME);
    if (!p) {
      window.alert("创建示例项目失败：本地存储写入失败（可能已满）");
      return;
    }
    refresh();
    openProject(p.id, true);
  };

  const remove = (id: string) => {
    if (!user) return;
    if (!window.confirm("删除该项目及其全部材料与版本？此操作不可恢复。")) return;
    if (!deleteProject(user, id)) window.alert("删除失败：本地存储写入异常，项目可能仍存在");
    refresh();
  };

  if (!ready || !session) return null;

  return (
    <main className="min-h-screen p-6">
      <div className="max-w-4xl mx-auto">
        <header className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-xl font-bold">🛡 GateKeeper</h1>
            <p className="text-xs text-slate-500">AI 质量门禁工作台 · 测试左移</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs bg-white border border-slate-200 rounded-full px-3 py-1.5 text-slate-600">
              👤 {user}
              {session.mode === "guest" ? "（游客）" : ""}
            </span>
            <button className="text-xs text-slate-400 hover:text-red-500" onClick={logout}>
              退出
            </button>
          </div>
        </header>

        <section className="bg-white rounded-2xl shadow p-6 mb-6">
          <p className="text-center text-slate-600 text-sm mb-5">
            从需求评审到提测准入，三道左移门禁的产物由 AI 现场生成、可视化展示、对话迭代
          </p>
          <div className="flex gap-2 justify-center flex-wrap">
            <input
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm w-64"
              placeholder="质量项目名称，如：优惠券功能重构"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") newProject();
              }}
            />
            <button
              className="bg-indigo-600 text-white rounded-lg px-4 py-2 text-sm hover:bg-indigo-700"
              onClick={newProject}
            >
              ＋ 新建质量项目
            </button>
            <button
              className="bg-white border border-indigo-600 text-indigo-600 rounded-lg px-4 py-2 text-sm hover:bg-indigo-50"
              onClick={loadDemo}
            >
              📖 加载示例项目
            </button>
          </div>
        </section>

        <h2 className="text-sm font-semibold text-slate-500 mb-3">
          我的项目<span className="ml-2 font-normal text-xs text-slate-400">从属层级：项目 → 需求材料/门禁产物 → 版本 · 门禁点：绿=通过 黄=有条件 红=打回 灰=未判定</span>
        </h2>
        {projects.length === 0 ? (
          <p className="text-sm text-slate-400 bg-white rounded-xl p-6 text-center">
            暂无项目 —— 点击上方「新建质量项目」或「加载示例项目」
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {projects.map((p) => {
              const passed = GATE_DOTS.filter((g) => p.gates[g]).length;
              const matCount = GATE_DOTS.filter((g) => (p.materials[g] ?? "").trim()).length;
              const verCount = listVersions(p.id).length;
              return (
                <div key={p.id} className="bg-white rounded-xl shadow p-4">
                  <div className="font-medium text-sm mb-2 truncate">{p.name}</div>
                  <div className="flex items-center gap-1.5 text-xs text-slate-500 mb-1">
                    <span>门禁</span>
                    {/* 卡片门禁点三态着色：被打回的门在首页就该看得见（项目健康度一眼可知） */}
                    {GATE_DOTS.map((g) => {
                      const verdict = p.judgments?.[g]?.verdict;
                      const cls =
                        verdict === "reject"
                          ? "text-red-500"
                          : verdict === "conditional"
                            ? "text-amber-500"
                            : p.gates[g]
                              ? "text-emerald-500"
                              : "text-slate-300";
                      const tip =
                        verdict === "reject"
                          ? "被打回"
                          : verdict === "conditional"
                            ? "有条件通过"
                            : p.gates[g]
                              ? "已通过"
                              : "未判定";
                      return (
                        <span key={g} className={cls} title={tip}>
                          ●
                        </span>
                      );
                    })}
                    <span className="ml-1">{passed}/3</span>
                    <span className="ml-auto text-slate-400">
                      {new Date(p.createdAt).toLocaleString("zh-CN")}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-400 mb-3">
                    需求材料 {matCount}/3 门 · 产物版本 {verCount} 个
                  </div>
                  <div className="flex gap-2">
                    <button
                      className="text-xs bg-indigo-50 text-indigo-600 rounded px-3 py-1 hover:bg-indigo-100"
                      onClick={() => openProject(p.id)}
                    >
                      继续
                    </button>
                    <button
                      className="text-xs bg-slate-50 text-slate-400 rounded px-3 py-1 hover:bg-red-50 hover:text-red-500"
                      onClick={() => remove(p.id)}
                    >
                      删除
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <p className="mt-8 text-center text-xs text-slate-300">
          数据持久化于浏览器 localStorage · 按账号隔离 · 演示级本地鉴权（SHA-256），P1-0 升级服务端 DB+真实鉴权（docs/PRD.md）
        </p>
      </div>
    </main>
  );
}
