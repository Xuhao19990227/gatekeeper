// /api/generate —— 服务端 LLM 代理（PRD 4.1）
// 安全：token 只读 env，绝不下发前端；env 未配置 = Mock 模式（骨架全链路可跑通）
import { NextRequest, NextResponse } from "next/server";
import { buildPrompts } from "@/lib/prompts";
import type { Gate } from "@/lib/storage";

export const maxDuration = 300;

const MOCK_HTML = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><title>GateKeeper · Mock 产物</title>
<style>
body{font-family:system-ui,"Microsoft YaHei",sans-serif;background:#f8fafc;display:flex;align-items:center;justify-content:center;min-height:90vh;margin:0}
.card{background:#fff;border-radius:16px;padding:40px;max-width:440px;box-shadow:0 4px 16px rgba(0,0,0,.08);text-align:center}
.badge{display:inline-block;background:#eef2ff;color:#4f46e5;border-radius:999px;padding:4px 14px;font-size:12px;margin:8px 0}
h1{font-size:18px;margin:8px 0;color:#1e293b}
p{font-size:13px;color:#64748b;line-height:1.8}
</style></head>
<body><div class="card">
<div style="font-size:40px">🛡</div>
<div class="badge">MOCK 模式</div>
<h1>LLM 通道未配置或不可用</h1>
<p>这是骨架占位产物：说明「材料 → /api/generate → iframe 预览」全链路已打通。<br><br>在 <b>.env.local</b> 配置 LLM_BASE_URL / LLM_AUTH_TOKEN / LLM_MODEL / LLM_FORMAT 后重启 dev server，即可获得真实 AI 生成产物。</p>
</div></body></html>`;

function extractHtml(text: string): string {
  const fence = text.match(/```(?:html)?\s*([\s\S]*?)```/i);
  let html = fence ? fence[1] : text;
  const i = html.search(/<!DOCTYPE html>/i);
  if (i > 0) html = html.slice(i);
  return html.trim();
}

export async function POST(req: NextRequest) {
  // 接口防护：公网部署时防止端点被脚本直打烧 LLM token。
  // 演示级方案（guard 编译进前端，非真安全）——生产化接真实鉴权，取舍写进说明文档。
  // 未配置 NEXT_PUBLIC_GK_GUARD 时不校验（本地开发零摩擦）。
  const guard = process.env.NEXT_PUBLIC_GK_GUARD ?? "";
  if (guard && req.headers.get("x-gk-guard") !== guard) {
    return NextResponse.json({ error: "拒绝访问" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }

  // 非法 gate 回 400，不再静默降级成 g1（缺入参校验=静默生成错误产物，比报错更难排查）
  const gateRaw = body.gate;
  if (gateRaw !== "g1" && gateRaw !== "g2" && gateRaw !== "g3") {
    return NextResponse.json({ error: "gate 必须是 g1 / g2 / g3 之一" }, { status: 400 });
  }
  const gate: Gate = gateRaw;
  const { system, user } = buildPrompts({
    gate,
    materials: String(body.materials ?? ""),
    instruction: String(body.instruction ?? "首次生成"),
    previousHtml: typeof body.previousHtml === "string" ? body.previousHtml : undefined,
    gateContextHtml: typeof body.gateContextHtml === "string" ? body.gateContextHtml : undefined,
  });

  const baseUrl = process.env.LLM_BASE_URL ?? "";
  const token = process.env.LLM_AUTH_TOKEN ?? "";
  const model = process.env.LLM_MODEL ?? "qwen3.8-max";
  const format = process.env.LLM_FORMAT ?? "anthropic";

  // Mock 模式：无凭据时返回占位产物，保证骨架链路可演示
  if (!baseUrl || !token) {
    await new Promise((r) => setTimeout(r, 600));
    return NextResponse.json({ html: MOCK_HTML, mock: true });
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 150_000);
  try {
    let text = "";
    if (format === "openai") {
      const res = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          model,
          temperature: 0.3,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }),
        signal: ctrl.signal,
      });
      const data = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
        error?: { message?: string };
      };
      if (!res.ok) throw new Error(`LLM HTTP ${res.status}: ${data.error?.message ?? JSON.stringify(data).slice(0, 200)}`);
      text = data.choices?.[0]?.message?.content ?? "";
    } else {
      const res = await fetch(`${baseUrl.replace(/\/$/, "")}/v1/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "x-api-key": token,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: 16000,
          // 思考预算：qwen3.8-max 默认放开思考会吃掉全部输出额度（实测 65s+ 无 text 块）；
          // budget 1024 实测 8.5s 出完整产物。2048 给复杂报告留余量。
          // 注意：Anthropic 格式下 thinking 与 temperature 不兼容，故移除 temperature
          thinking: { type: "enabled", budget_tokens: 2048 },
          system,
          messages: [{ role: "user", content: user }],
        }),
        signal: ctrl.signal,
      });
      const data = (await res.json()) as {
        content?: { type?: string; text?: string }[];
        stop_reason?: string;
        error?: { message?: string };
      };
      if (!res.ok) throw new Error(`LLM HTTP ${res.status}: ${data.error?.message ?? JSON.stringify(data).slice(0, 200)}`);
      // qwen3.8-max 是思考模型：content 含 thinking 块，必须挑出 type=text 块拼接
      // （2026-10-31 实测教训：取 content[0].text 拿到 thinking 块 = undefined = 永远"返回空内容"）
      text = (data.content ?? [])
        .filter((b) => b.type === "text")
        .map((b) => b.text ?? "")
        .join("");
      if (data.stop_reason === "max_tokens")
        throw new Error("输出额度耗尽被截断（思考过长或产物过大）——请重试或简化材料");
    }
    if (!text.trim()) throw new Error("LLM 返回空内容");
    return NextResponse.json({ html: extractHtml(text) });
  } catch (e) {
    const err = e as { name?: string; message?: string };
    const msg = err?.name === "AbortError" ? "LLM 调用超时（150s），请重试或简化材料" : `LLM 调用失败：${err?.message ?? e}`;
    return NextResponse.json({ error: msg }, { status: 502 });
  } finally {
    clearTimeout(timer);
  }
}
