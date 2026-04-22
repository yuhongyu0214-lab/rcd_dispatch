import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "人车单调度系统",
  description: "调度系统工程底座第一阶段：可启动"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
