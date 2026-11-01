"use client";

// 屏 0 · 登录/注册页（PRD 3.5：三通道=登录/注册/游客；演示级本地鉴权，P1-0 换服务端真实鉴权时本页保留）
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createAccount, verifyAccount, sha256, setSession, getSession } from "@/lib/storage";

export default function LoginPage() {
  const router = useRouter();
  const [tab, setTab] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [guestName, setGuestName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (getSession()) router.replace("/");
  }, [router]);

  const enter = (user: string, mode: "account" | "guest") => {
    setSession({ username: user, mode });
    router.replace("/");
  };

  const doLogin = async () => {
    setError("");
    const u = username.trim();
    if (!u || !password) {
      setError("请输入用户名和密码");
      return;
    }
    setBusy(true);
    try {
      const digest = await sha256(password);
      if (!verifyAccount(u, digest)) {
        setError("用户名或密码错误（账号仅存于本浏览器，演示级）");
        return;
      }
      enter(u, "account");
    } finally {
      setBusy(false);
    }
  };

  const doRegister = async () => {
    setError("");
    const u = username.trim();
    if (!u || !password) {
      setError("请输入用户名和密码");
      return;
    }
    if (password.length < 6) {
      setError("密码至少 6 位");
      return;
    }
    if (password !== confirm) {
      setError("两次输入的密码不一致");
      return;
    }
    setBusy(true);
    try {
      const digest = await sha256(password);
      const r = createAccount(u, digest);
      if (!r.ok) {
        setError(r.error ?? "注册失败");
        return;
      }
      enter(u, "account");
    } finally {
      setBusy(false);
    }
  };

  const doGuest = () => {
    setError("");
    const g = guestName.trim();
    if (!g) {
      setError("游客通道请输入一个称呼");
      return;
    }
    enter(g, "guest");
  };

  const inputCls =
    "w-full border border-slate-300 rounded-lg px-3 py-2 mb-3 text-sm focus:outline-none focus:border-indigo-400";

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow p-8">
        <div className="text-center text-4xl mb-2">🛡</div>
        <h1 className="text-center text-xl font-bold mb-1">
          {tab === "login" ? "GateKeeper" : "创建账号"}
        </h1>
        <p className="text-center text-xs text-slate-500 mb-5">
          {tab === "login"
            ? "AI 质量门禁工作台 · 测试左移"
            : "注册后项目与版本历史按账号隔离（本浏览器内）"}
        </p>

        <div className="flex bg-slate-100 rounded-xl p-1 mb-5">
          <button
            className={`flex-1 text-sm rounded-lg py-1.5 ${tab === "login" ? "bg-white font-semibold text-indigo-600 shadow-sm" : "text-slate-400"}`}
            onClick={() => { setTab("login"); setError(""); }}
          >
            登录
          </button>
          <button
            className={`flex-1 text-sm rounded-lg py-1.5 ${tab === "register" ? "bg-white font-semibold text-indigo-600 shadow-sm" : "text-slate-400"}`}
            onClick={() => { setTab("register"); setError(""); }}
          >
            注册
          </button>
        </div>

        <input className={inputCls} placeholder="用户名" value={username} onChange={(e) => setUsername(e.target.value)} />
        <input className={inputCls} type="password" placeholder="密码" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && tab === "login") doLogin(); }} />
        {tab === "register" && (
          <input className={inputCls} type="password" placeholder="确认密码" value={confirm} onChange={(e) => setConfirm(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") doRegister(); }} />
        )}

        {error && <p className="text-xs text-red-500 bg-red-50 rounded p-2 mb-3">⚠ {error}</p>}

        <button
          className="w-full bg-indigo-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 mb-4"
          disabled={busy}
          onClick={tab === "login" ? doLogin : doRegister}
        >
          {busy ? "请稍候…" : tab === "login" ? "进入工作台" : "创建账号并进入"}
        </button>

        <div className="border-t border-dashed border-slate-200 pt-4">
          <p className="text-xs text-slate-400 text-center mb-2">不想注册？游客通道数据仅存本机</p>
          <div className="flex gap-2">
            <input
              className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-400"
              placeholder="游客称呼，如：评审员老王"
              value={guestName}
              onChange={(e) => setGuestName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") doGuest(); }}
            />
            <button className="bg-white border border-indigo-600 text-indigo-600 rounded-lg px-4 py-2 text-sm hover:bg-indigo-50 whitespace-nowrap" onClick={doGuest}>
              👀 游客进入
            </button>
          </div>
        </div>

        <p className="mt-5 text-[10px] leading-relaxed text-slate-300 text-center">
          演示级声明：账号存于浏览器本地（密码 SHA-256 摘要，非服务端鉴权）；生产化升级服务端真实鉴权见 docs/PRD.md 3.5 / 5.2
        </p>
      </div>
    </main>
  );
}
