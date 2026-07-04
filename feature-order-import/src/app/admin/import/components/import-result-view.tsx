"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import type { ImportSummary } from "@/lib/import/types";

type ResultResponse =
  | {
      success: true;
      data: ImportSummary;
      error: null;
      traceId: string;
    }
  | {
      success: false;
      data: null;
      error: string;
      traceId: string;
    };

function IssueTable(props: {
  title: string;
  rows: ImportSummary["failedRows"];
  tone: "error" | "warning";
}) {
  const { title, rows, tone } = props;

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-slate-900">{title}</h2>
        <span
          className={`rounded-full px-3 py-1 text-xs font-medium ${
            tone === "error"
              ? "bg-rose-50 text-rose-700"
              : "bg-amber-50 text-amber-700"
          }`}
        >
          {rows.length} 条
        </span>
      </div>

      {rows.length === 0 ? (
        <p className="mt-4 text-sm text-slate-500">暂无记录</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="px-3 py-2">行号</th>
                <th className="px-3 py-2">订单号</th>
                <th className="px-3 py-2">问题明细</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row) => (
                <tr key={`${title}-${row.rowNumber}`}>
                  <td className="px-3 py-3 align-top">{row.rowNumber}</td>
                  <td className="px-3 py-3 align-top">{row.orderId ?? "-"}</td>
                  <td className="px-3 py-3 align-top">
                    <div className="space-y-1">
                      {row.issues.map((issue) => (
                        <p key={`${row.rowNumber}-${issue.code}-${issue.field}`} className="text-slate-700">
                          {issue.message}
                        </p>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function ImportResultView({ batchId }: { batchId: string | null }) {
  const router = useRouter();
  const [result, setResult] = useState<ImportSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!batchId) {
      setError("缺少 batchId，无法加载导入结果");
      setLoading(false);
      return;
    }

    async function fetchResult() {
      try {
        const response = await fetch(
          `/api/import/orders/result?batchId=${encodeURIComponent(batchId)}`,
          {
            cache: "no-store"
          }
        );

        if (response.status === 401) {
          router.replace(
            `/admin/login?next=${encodeURIComponent(
              `/admin/import/result?batchId=${batchId}`
            )}`
          );
          router.refresh();
          return;
        }

        const payload = (await response.json()) as ResultResponse;

        if (!payload.success) {
          setError(`${payload.error}（traceId: ${payload.traceId}）`);
          return;
        }

        setResult(payload.data);
      } catch {
        setError("加载导入结果失败，请稍后重试");
      } finally {
        setLoading(false);
      }
    }

    void fetchResult();
  }, [batchId, router]);

  if (loading) {
    return <div className="rounded-3xl border border-slate-200 bg-white p-8 text-sm text-slate-600 shadow-sm">正在加载导入结果...</div>;
  }

  if (error || !result) {
    return (
      <div className="rounded-3xl border border-rose-200 bg-rose-50 p-8 text-sm text-rose-700 shadow-sm">
        <p>{error ?? "导入结果不存在"}</p>
        <Link href="/admin/import" className="mt-4 inline-block underline underline-offset-4">
          返回导入页
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium uppercase tracking-[0.25em] text-slate-500">
              Import Result
            </p>
            <h1 className="mt-2 text-3xl font-semibold text-slate-900">导入结果</h1>
            <p className="mt-2 text-sm text-slate-600">批次号：{result.batchId}</p>
            <p className="mt-1 text-sm text-slate-600">导入时间：{new Date(result.importedAt).toLocaleString("zh-CN")}</p>
          </div>
          <Link href="/admin/import" className="text-sm text-slate-600 underline underline-offset-4">
            继续导入
          </Link>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-4">
          <div className="rounded-2xl bg-slate-50 p-4">
            <p className="text-sm text-slate-500">总条数</p>
            <p className="mt-2 text-2xl font-semibold">{result.totalCount}</p>
          </div>
          <div className="rounded-2xl bg-emerald-50 p-4">
            <p className="text-sm text-emerald-700">成功</p>
            <p className="mt-2 text-2xl font-semibold text-emerald-800">{result.successCount}</p>
          </div>
          <div className="rounded-2xl bg-rose-50 p-4">
            <p className="text-sm text-rose-700">失败</p>
            <p className="mt-2 text-2xl font-semibold text-rose-800">{result.failureCount}</p>
          </div>
          <div className="rounded-2xl bg-amber-50 p-4">
            <p className="text-sm text-amber-700">警告</p>
            <p className="mt-2 text-2xl font-semibold text-amber-800">{result.warningCount}</p>
          </div>
        </div>
      </section>

      <IssueTable title="失败明细" rows={result.failedRows} tone="error" />
      <IssueTable title="警告明细" rows={result.warningRows} tone="warning" />
    </div>
  );
}
