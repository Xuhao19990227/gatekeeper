# 🛡 GateKeeper · AI 质量门禁工作台

> 测试左移——从需求评审到提测准入，每道门禁的产物由 AI 现场生成。
> 本项目以 AI 协作方式开发（Claude Code 驱动，PRD 先行、里程碑式交付）。

## 快速开始

```bash
npm install
cp env.example .env.local   # 填入 LLM 通道（BASE_URL/TOKEN/MODEL/FORMAT）；不填=Mock 模式
npm run dev                 # http://localhost:3000
```

## 架构

```
材料面板/对话迭代 → /api/generate（服务端 LLM 代理，env 驱动双格式：Anthropic/OpenAI 兼容）
→ LLM 按门禁角色包生成单文件 HTML 产物 → iframe sandbox 实时预览 → localStorage 持久化
```

- 三道门禁：Gate1 需求评审 → Gate2 用例左移 → Gate3 提测准入（跨门上下文自动传递）
- 示例项目：一键加载，G1 预填示例需求文档、G3 预填示例代码 diff；G2 材料刻意留空——现场演示跨门上下文如何把评审测试点自动转化为用例
- 延展能力：版本历史+回滚、产物导出 HTML
- 需求文档：`docs/PRD.md`（含原型图/接口契约/取舍/验收标准）

## 文档

- [需求文档 PRD](docs/PRD.md)
- 在线体验链接：（部署后填写）
