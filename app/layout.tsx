import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "GateKeeper · AI 质量门禁工作台",
  description: "测试左移——从需求评审到提测准入，每道门禁的产物由 AI 现场生成",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
