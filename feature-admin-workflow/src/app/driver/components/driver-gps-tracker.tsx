"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// ============================================================================
// 类型定义
// ============================================================================

type GpsStatus = "active" | "degraded" | "error" | "idle";

// ============================================================================
// 常量
// ============================================================================

/** 前台上报最小间隔（毫秒） */
const FOREGROUND_MIN_INTERVAL = 5_000;

/** 后台兜底上报间隔（毫秒） */
const BACKGROUND_FALLBACK_INTERVAL = 120_000;

/** 连续失败阈值 */
const DEGRADED_THRESHOLD = 2;
const ERROR_THRESHOLD = 5;

/** 恢复检测窗口 */
const RECOVERY_CHECK_MS = 30_000;

// ============================================================================
// DriverGpsTracker
// ============================================================================

export function DriverGpsTracker({ driverId }: { driverId: string }) {
  const [status, setStatus] = useState<GpsStatus>("idle");
  const [lastReportedAt, setLastReportedAt] = useState<Date | null>(null);
  const [errorCount, setErrorCount] = useState(0);
  const [permissionDenied, setPermissionDenied] = useState(false);

  const watchId = useRef<number | null>(null);
  const fallbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastReportTime = useRef<number>(0);
  const consecutiveErrors = useRef(0);
  const recoveryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---- 上报函数 ----
  const reportLocation = useCallback(
    async (lat: number, lng: number, accuracy?: number) => {
      try {
        const response = await fetch("/api/driver/location", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ lat, lng, accuracy, driverId })
        });

        if (response.ok) {
          consecutiveErrors.current = 0;
          setErrorCount(0);
          lastReportTime.current = Date.now();
          setLastReportedAt(new Date());

          // 根据连续失败次数恢复状态
          if (errorCount >= ERROR_THRESHOLD) {
            setStatus("degraded"); // 从 error 降为 degraded，探测中
            if (recoveryTimer.current) clearTimeout(recoveryTimer.current);
            recoveryTimer.current = setTimeout(() => {
              setStatus("active");
            }, RECOVERY_CHECK_MS);
          } else if (errorCount >= DEGRADED_THRESHOLD) {
            setStatus("active");
          }
        } else {
          throw new Error(`HTTP ${response.status}`);
        }
      } catch {
        consecutiveErrors.current += 1;
        setErrorCount(consecutiveErrors.current);

        if (consecutiveErrors.current >= ERROR_THRESHOLD) {
          setStatus("error");
        } else if (consecutiveErrors.current >= DEGRADED_THRESHOLD) {
          setStatus("degraded");
        }
      }
    },
    [driverId, errorCount]
  );

  // ---- 兜底定时器 ----
  const scheduleFallback = useCallback(() => {
    if (fallbackTimer.current) clearTimeout(fallbackTimer.current);

    fallbackTimer.current = setTimeout(() => {
      // 仅在后台且长时间未上报时启用兜底
      if (document.hidden) {
        const elapsed = Date.now() - lastReportTime.current;
        if (elapsed >= BACKGROUND_FALLBACK_INTERVAL) {
          // 主动拉取一次当前位置
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              reportLocation(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy);
            },
            () => {
              // 兜底拉取失败也计入错误
              consecutiveErrors.current += 1;
            },
            { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 }
          );
        }
      }
      scheduleFallback(); // 递归调度下一次
    }, BACKGROUND_FALLBACK_INTERVAL);
  }, [reportLocation]);

  // ---- watchPosition 主监听 ----
  useEffect(() => {
    if (!navigator.geolocation) {
      setStatus("error");
      return;
    }

    // 先检查权限状态
    if (navigator.permissions) {
      navigator.permissions.query({ name: "geolocation" }).then((result) => {
        if (result.state === "denied") {
          setPermissionDenied(true);
          setStatus("error");
        }
      }).catch(() => {
        // permissions API 不可用，跳过预检
      });
    }

    watchId.current = navigator.geolocation.watchPosition(
      (position) => {
        const elapsed = Date.now() - lastReportTime.current;

        // 前台：间隔 >= 5 秒才上报；后台：始终上报（自然频率已降低）
        if (!document.hidden && elapsed < FOREGROUND_MIN_INTERVAL) return;

        setStatus("active");
        setPermissionDenied(false);
        reportLocation(
          position.coords.latitude,
          position.coords.longitude,
          position.coords.accuracy
        );
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          setPermissionDenied(true);
          setStatus("error");
        }
        consecutiveErrors.current += 1;
        setErrorCount(consecutiveErrors.current);
      },
      {
        enableHighAccuracy: true,
        timeout: 30_000,
        maximumAge: 30_000
      }
    );

    // 启动后台兜底
    scheduleFallback();

    return () => {
      if (watchId.current !== null) {
        navigator.geolocation.clearWatch(watchId.current);
      }
      if (fallbackTimer.current) clearTimeout(fallbackTimer.current);
      if (recoveryTimer.current) clearTimeout(recoveryTimer.current);
    };
  }, [driverId, reportLocation, scheduleFallback]);

  // ---- 状态指示器 ----
  const statusDot: Record<GpsStatus, string> = {
    active: "bg-emerald-500",
    degraded: "bg-amber-400",
    error: "bg-red-500",
    idle: "bg-slate-300"
  };

  const statusLabel: Record<GpsStatus, string> = {
    active: "GPS 正常",
    degraded: "GPS 信号弱",
    error: permissionDenied ? "定位权限未开启" : "GPS 异常",
    idle: "GPS 启动中"
  };

  const lastReportText = lastReportedAt
    ? `最近上报 ${Math.round((Date.now() - lastReportedAt.getTime()) / 1000)}s 前`
    : "等待首次上报";

  return (
    <div className="flex items-center gap-2 text-xs text-slate-500">
      <span className={`inline-block h-2 w-2 rounded-full ${statusDot[status]}`} />
      <span>{statusLabel[status]}</span>
      <span className="text-slate-400">·</span>
      <span>{lastReportText}</span>
    </div>
  );
}
