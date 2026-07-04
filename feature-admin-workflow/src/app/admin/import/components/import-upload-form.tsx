"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useMemo, useState } from "react";

type UploadResponse =
  | {
      success: true;
      data: {
        batchId: string;
      };
      error: null;
      traceId: string;
    }
  | {
      success: false;
      data: null;
      error: string;
      traceId: string;
    };

export function ImportUploadForm() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileName = useMemo(() => file?.name ?? "尚未选择文件", [file]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!file) {
      setError("请先选择一个 .xlsx 文件");
      return;
    }

    if (!file.name.toLowerCase().endsWith(".xlsx")) {
      setError("仅支持上传 .xlsx 文件");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/import/orders", {
        method: "POST",
        body: formData
      });

      if (response.status === 401) {
        router.replace("/admin/login?next=%2Fadmin%2Fimport");
        router.refresh();
        return;
      }

      const payload = (await response.json()) as UploadResponse;

      if (!payload.success) {
        setError(`${payload.error}（traceId: ${payload.traceId}）`);
        return;
      }

      router.push(
        `/admin/import/result?batchId=${encodeURIComponent(payload.data.batchId)}`
      );
    } catch {
      setError("上传失败，请检查网络后重试");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-6 rounded-3xl border border-slate-200 bg-white p-8 shadow-sm"
    >
      <div className="space-y-2">
        <h2 className="text-2xl font-semibold text-slate-900">订单 Excel 导入</h2>
        <p className="text-sm leading-6 text-slate-600">
          仅支持标准模板 `.xlsx` 文件，单次最多 200 行，文件大小不超过 10MB。
        </p>
      </div>

      <label className="flex cursor-pointer flex-col gap-3 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-700">
        <span className="font-medium text-slate-900">选择导入文件</span>
        <span>当前文件：{fileName}</span>
        <input
          type="file"
          accept=".xlsx"
          className="text-sm"
          onChange={(event) => {
            setFile(event.target.files?.[0] ?? null);
            setError(null);
          }}
        />
      </label>

      <div className="rounded-2xl bg-slate-50 p-4 text-sm leading-6 text-slate-600">
        <p>模板必填列：orderId、orderType、storeId、vehicleType、licensePlate、channel、driverName、pickupAddress、returnAddress、scheduledAt</p>
        <p>地理编码失败不会阻断入库，但结果页会提示待补全。</p>
      </div>

      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      <button
        type="submit"
        disabled={!file || submitting}
        className="inline-flex h-11 items-center justify-center rounded-xl bg-slate-900 px-5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-slate-300"
      >
        {submitting ? "正在导入..." : "开始导入"}
      </button>
    </form>
  );
}
