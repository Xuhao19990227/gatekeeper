// GateKeeper 本地持久化层（PRD 4.2 · schema v2）
// 从属层级：项目 → (每门需求材料 materials + 过门产物 gates) → 产物 1→N 版本(versions 按 gate 分组)
// 取舍声明：localStorage 客户端持久化，换取交付确定性 + 用户侧零第三方依赖；
// 存储访问统一走本文件（适配器模式），P1-0 升级服务端 DB + 真实鉴权时页面代码零改动。

export type Gate = "g1" | "g2" | "g3";

export interface Judgment {
  verdict: "pass" | "conditional" | "reject"; // 三态判定（PRD 第2节）
  note: string; // 有条件通过备注 / 打回意见（随版本留痕，导出产物可附）
  versionId: string | null; // 判定针对的产物版本
  at: string;
}

export interface Project {
  id: string;
  name: string;
  createdAt: string;
  materials: Record<Gate, string>; // 每门的需求材料（PRD/测试点/diff），从属项目、即输即存
  gates: Record<Gate, string | null>; // 每门"已过门"锁定的版本 id（=产物当前版）
  judgments: Partial<Record<Gate, Judgment>>; // 每门最近一次平台侧判定（三态留痕）
}

export interface Version {
  id: string;
  projectId: string;
  gate: Gate;
  instruction: string;
  html: string;
  createdAt: string;
}

export interface Account {
  username: string;
  passDigest: string; // SHA-256 摘要（演示级本地鉴权；P1-0 升级服务端哈希+会话）
  createdAt: string;
}

export interface Session {
  username: string;
  mode: "account" | "guest";
}

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

const EMPTY_MATERIALS = (): Record<Gate, string> => ({ g1: "", g2: "", g3: "" });
const EMPTY_GATES = (): Record<Gate, string | null> => ({ g1: null, g2: null, g3: null });

function read<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

// 写入失败必须显性返回 false，由调用方提示「未保存成功」（PRD 4.5 可靠性）
// 静默吞异常 + 无 session 静默 return = 数据丢了 UI 还显示保存成功（写后查违规）
function write(key: string, value: unknown): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false; // 配额满等异常：返回 false，调用方负责提示
  }
}

const projectsKey = (user: string) => `gk_projects_${user}`;
const versionsKey = (projectId: string) => `gk_versions_${projectId}`;

// ---- 账号与会话（演示级本地鉴权，PRD 3.5 诚实声明）----

export async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function listAccounts(): Account[] {
  return read<Account[]>("gk_accounts", []);
}

export function createAccount(username: string, passDigest: string): { ok: boolean; error?: string } {
  const accounts = listAccounts();
  if (accounts.some((a) => a.username === username)) return { ok: false, error: "用户名已存在" };
  const saved = write("gk_accounts", [...accounts, { username, passDigest, createdAt: new Date().toISOString() }]);
  return saved ? { ok: true } : { ok: false, error: "本地存储写入失败（可能已满），注册未完成" };
}

export function verifyAccount(username: string, passDigest: string): boolean {
  return listAccounts().some((a) => a.username === username && a.passDigest === passDigest);
}

export function getSession(): Session | null {
  return read<Session | null>("gk_session", null);
}

export function setSession(s: Session): void {
  write("gk_session", s);
}

export function clearSession(): void {
  if (typeof window !== "undefined") window.localStorage.removeItem("gk_session");
}

// ---- 项目（从属：会话用户）----

export function listProjects(user: string): Project[] {
  return read<Project[]>(projectsKey(user), []).map((p) => ({
    ...p,
    materials: p.materials ?? EMPTY_MATERIALS(), // 兼容 v1/v2 存量数据
    gates: p.gates ?? EMPTY_GATES(),
    judgments: p.judgments ?? {},
  }));
}

export function createProject(user: string, name: string): Project | null {
  const p: Project = {
    id: uid(),
    name,
    createdAt: new Date().toISOString(),
    materials: EMPTY_MATERIALS(),
    gates: EMPTY_GATES(),
    judgments: {},
  };
  const ok = write(projectsKey(user), [p, ...read<Project[]>(projectsKey(user), [])]);
  return ok ? p : null;
}

export function deleteProject(user: string, id: string): boolean {
  const ok = write(projectsKey(user), read<Project[]>(projectsKey(user), []).filter((p) => p.id !== id));
  if (typeof window !== "undefined") window.localStorage.removeItem(versionsKey(id));
  return ok;
}

function currentUser(): string | null {
  return getSession()?.username ?? null;
}

export function updateProjectGates(id: string, gates: Record<Gate, string | null>): boolean {
  const user = currentUser();
  if (!user) return false; // 会话丢失=写不进去，必须让调用方知道（此前静默丢数据）
  return write(projectsKey(user), listProjects(user).map((p) => (p.id === id ? { ...p, gates } : p)));
}

export function recordJudgment(id: string, gate: Gate, j: Judgment): boolean {
  const user = currentUser();
  if (!user) return false;
  return write(
    projectsKey(user),
    listProjects(user).map((p) =>
      p.id === id ? { ...p, judgments: { ...p.judgments, [gate]: j } } : p
    )
  );
}

export function updateProjectMaterials(id: string, gate: Gate, text: string): boolean {
  const user = currentUser();
  if (!user) return false;
  return write(
    projectsKey(user),
    listProjects(user).map((p) =>
      p.id === id ? { ...p, materials: { ...p.materials, [gate]: text } } : p
    )
  );
}

// ---- 版本（从属：项目 × 门禁 = 产物的版本链）----

export function listVersions(projectId: string): Version[] {
  return read<Version[]>(versionsKey(projectId), []);
}

export function addVersion(
  projectId: string,
  v: { gate: Gate; instruction: string; html: string }
): Version | null {
  const ver: Version = {
    id: uid(),
    projectId,
    gate: v.gate,
    instruction: v.instruction,
    html: v.html,
    createdAt: new Date().toISOString(),
  };
  const ok = write(versionsKey(projectId), [...listVersions(projectId), ver]);
  return ok ? ver : null; // 存盘失败返回 null，调用方提示「未保存成功」
}
