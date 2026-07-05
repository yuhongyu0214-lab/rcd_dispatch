"use client";

import { useState } from "react";

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // 降级：选中文本供用户手动复制
      alert(`请手动复制订单号：${text}`);
    }
  }

  return (
    <button
      onClick={handleCopy}
      className="rounded-lg border border-slate-200 px-2 py-0.5 text-xs text-slate-500 transition active:bg-slate-50"
    >
      {copied ? "已复制 ✓" : "📋 复制"}
    </button>
  );
}
