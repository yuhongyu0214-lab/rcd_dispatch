"use client";

import { type CSSProperties, useEffect, useMemo, useRef } from "react";

import type { AssignmentSummaryV2, AssignmentV2, OrderV2 } from "@/types/v2";

import {
  buildDriverGantt,
  ORDER_BUSINESS_META
} from "./dispatcher-console-model";
import {
  etaUnavailableReasonLabel,
  feasibilityMeta,
  segmentMeta
} from "./dispatcher-console-support";
import styles from "./dispatcher-console.module.css";

const GANTT_HOURS = 12;
const GANTT_MINUTES = GANTT_HOURS * 60;
const TIMELINE_SEGMENT_KINDS = [
  "IDLE",
  "DEADHEAD",
  "SERVICE_MODULES",
  "ORDER_DRIVE"
] as const;

const hourFormatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false
});

const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  month: "2-digit",
  day: "2-digit"
});

const dateTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false
});

export type DispatcherTimelineRow = {
  slot: "A" | "B" | "C";
  summary?: AssignmentSummaryV2;
  businessType?: OrderV2["businessType"];
  detail?: Pick<
    OrderV2,
    "businessType" | "feasibility" | "licensePlateSnapshot"
  >;
  assignment?: AssignmentV2;
  licensePlateSnapshot?: string;
};

export function DispatcherConsoleTimeline({
  driverName,
  loading,
  nowMs,
  rows,
  onSelectOrder
}: {
  driverName?: string;
  loading: boolean;
  nowMs: number;
  rows: readonly DispatcherTimelineRow[];
  onSelectOrder: (orderId: string) => void;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const gantt = useMemo(
    () =>
      buildDriverGantt(
        rows.map((row) => ({
          slot: row.slot,
          orderId: row.summary?.orderId,
          orderNo: row.summary?.orderNo,
          businessType: row.businessType ?? row.detail?.businessType,
          feasibility: row.detail?.feasibility,
          assignment: row.assignment
        })),
        nowMs
      ),
    [nowMs, rows]
  );
  const ticks = useMemo(
    () =>
      Array.from({ length: GANTT_HOURS }, (_, index) => ({
        index,
        value: gantt.windowStartMs + index * 60 * 60 * 1_000
      })),
    [gantt.windowStartMs]
  );
  const orderBands = useMemo(() => {
    const bands = new Map<
      string,
      {
        orderId: string;
        orderNo: string;
        licensePlateSnapshot?: string;
        slot?: DispatcherTimelineRow["slot"];
        businessType?: OrderV2["businessType"];
        feasibility?: OrderV2["feasibility"];
        startAtMs: number;
        endAtMs: number;
      }
    >();
    for (const block of gantt.blocks) {
      if (!block.orderId || !block.orderNo) continue;
      const existing = bands.get(block.orderId);
      if (existing) {
        existing.startAtMs = Math.min(existing.startAtMs, block.startAtMs);
        existing.endAtMs = Math.max(existing.endAtMs, block.endAtMs);
        continue;
      }
      bands.set(block.orderId, {
        orderId: block.orderId,
        orderNo: block.orderNo,
        licensePlateSnapshot: rows.find(
          (row) => row.summary?.orderId === block.orderId
        )?.licensePlateSnapshot,
        slot: block.slot,
        businessType: block.businessType,
        feasibility: block.feasibility,
        startAtMs: block.startAtMs,
        endAtMs: block.endAtMs
      });
    }
    return [...bands.values()].sort(
      (left, right) => left.startAtMs - right.startAtMs
    );
  }, [gantt.blocks, rows]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const frame = window.requestAnimationFrame(() => {
      const focusPx =
        (gantt.focusOffsetMinutes / GANTT_MINUTES) * scroller.scrollWidth;
      scroller.scrollLeft = Math.max(0, focusPx - scroller.clientWidth * 0.2);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [gantt.focusOffsetMinutes, gantt.windowStartMs]);

  const nowOffsetMinutes = (nowMs - gantt.windowStartMs) / 60_000;
  const showNow =
    nowMs > 0 && nowOffsetMinutes >= 0 && nowOffsetMinutes <= GANTT_MINUTES;
  const planDateLabel = dateFormatter
    .format(gantt.windowStartMs)
    .replace("/", "-");

  return (
    <section className={styles.timelineSection} aria-label="司机 A/B/C 时间轴">
      <header className={styles.timelineHeader}>
        <div>
          <span>当前司机 · A/B/C 工单</span>
          <strong>{planDateLabel}</strong>
        </div>
        <div className={styles.ganttLegend} aria-label="时间轴图例">
          <span>
            <i className={styles.ganttLegendPICKUP} />
            取车工单
          </span>
          <span>
            <i className={styles.ganttLegendRETURN} />
            还车工单
          </span>
          {TIMELINE_SEGMENT_KINDS.map((kind) => (
            <span key={kind}>
              <b aria-hidden="true">{segmentMeta[kind].icon}</b>
              {segmentMeta[kind].label}
            </span>
          ))}
        </div>
        {loading ? (
          <span className={styles.srOnly} role="status">
            正在同步计划
          </span>
        ) : null}
      </header>
      <div className={styles.ganttBody}>
        <aside className={styles.ganttDriver} aria-label="当前司机">
          <span className={styles.ganttDriverHeader}>当前司机</span>
          <div className={styles.ganttDriverIdentity}>
            <span className={styles.ganttDriverAvatar}>
              {driverName?.slice(0, 1) ?? "—"}
            </span>
            <div>
              <strong>{driverName ?? "未选择司机"}</strong>
              <small>
                {rows.some((row) => row.summary)
                  ? "12 小时工单窗口"
                  : "当前 12 小时无工单"}
              </small>
            </div>
          </div>
        </aside>
        <div
          ref={scrollerRef}
          className={styles.ganttScroller}
          tabIndex={0}
          role="region"
          aria-label={`${driverName ?? "当前司机"} 12 小时工单甘特图，可左右滚动`}
        >
          <div className={styles.ganttCanvas}>
            <div className={styles.ganttAxis} aria-hidden="true">
              {ticks.map((tick) => (
                <span key={tick.index}>
                  <b>{hourFormatter.format(tick.value)}</b>
                </span>
              ))}
            </div>
            <div className={styles.ganttLane}>
              <div className={styles.ganttHourGrid} aria-hidden="true">
                {ticks.map((tick) => (
                  <span key={tick.index} />
                ))}
              </div>
              {orderBands.map((band) => {
                const business = band.businessType
                  ? ORDER_BUSINESS_META[band.businessType]
                  : undefined;
                const plateLabel =
                  band.licensePlateSnapshot ?? "车牌待绑定";
                const title = `${band.slot ? `${band.slot} 槽位 · ` : ""}${plateLabel} · 订单 ${band.orderNo}${
                  business ? ` · ${business.label}` : ""
                } · ${dateTimeFormatter.format(band.startAtMs)} 至 ${dateTimeFormatter.format(band.endAtMs)}`;
                const className = `${styles.ganttOrderBand} ${
                  business
                    ? styles[`ganttBusiness${business.visualKind}`]
                    : ""
                } ${
                  band.feasibility === "INFEASIBLE"
                    ? styles.ganttOrderBandDanger
                    : band.feasibility === "AT_RISK"
                      ? styles.ganttOrderBandRisk
                      : ""
                }`;
                return (
                  <button
                    type="button"
                    key={band.orderId}
                    className={className}
                    style={
                      {
                        "--gantt-left": `${((band.startAtMs - gantt.windowStartMs) / 60_000 / GANTT_MINUTES) * 100}%`,
                        "--gantt-width": `${((band.endAtMs - band.startAtMs) / 60_000 / GANTT_MINUTES) * 100}%`
                      } as CSSProperties
                    }
                    title={title}
                    aria-label={title}
                    onClick={() => onSelectOrder(band.orderId)}
                  >
                    <span>{plateLabel}</span>
                  </button>
                );
              })}
              {gantt.unavailableRows.length > 0 ? (
                <div className={styles.ganttUnavailable} role="status">
                  {gantt.unavailableRows.map((row) => (
                    <span key={`${row.slot}-${row.orderId ?? row.orderNo}`}>
                      <b>{row.slot}</b>
                      {row.orderNo ?? "工单"} · ETA 不可用：
                      {row.unavailableReason
                        ? etaUnavailableReasonLabel[row.unavailableReason]
                        : "计划分段不完整"}
                    </span>
                  ))}
                </div>
              ) : null}
              {gantt.blocks.map((block, index) => {
                const meta = segmentMeta[block.kind];
                const business = block.businessType
                  ? ORDER_BUSINESS_META[block.businessType]
                  : undefined;
                const title = `${block.slot ? `${block.slot} 槽位 · ` : ""}${
                  block.orderNo ? `${block.orderNo} · ` : ""
                }${meta.label} · ${dateTimeFormatter.format(block.startAtMs)} 至 ${dateTimeFormatter.format(block.endAtMs)} · ${Math.round(block.durationMinutes)} 分钟`;
                const blockStyle = {
                  "--gantt-left": `${(block.offsetMinutes / GANTT_MINUTES) * 100}%`,
                  "--gantt-width": `${(block.durationMinutes / GANTT_MINUTES) * 100}%`
                } as CSSProperties;
                const className = `${styles.ganttBlock} ${
                  styles[`ganttBlock${block.kind}`]
                } ${
                  business
                    ? styles[`ganttBusiness${business.visualKind}`]
                    : ""
                } ${
                  block.feasibility === "INFEASIBLE"
                    ? styles.ganttBlockDanger
                    : block.feasibility === "AT_RISK"
                      ? styles.ganttBlockRisk
                      : ""
                }`;
                const content = (
                  <>
                    <b aria-hidden="true">{meta.icon}</b>
                    <span>{meta.label}</span>
                    <small>{Math.round(block.durationMinutes)} 分</small>
                  </>
                );
                return block.orderId ? (
                  <button
                    type="button"
                    key={`${block.kind}-${block.orderId}-${index}`}
                    className={className}
                    style={blockStyle}
                    title={title}
                    aria-label={title}
                    onClick={() => onSelectOrder(block.orderId!)}
                  >
                    {content}
                  </button>
                ) : (
                  <div
                    key={`${block.kind}-${index}`}
                    className={className}
                    style={blockStyle}
                    title={title}
                  >
                    {content}
                  </div>
                );
              })}
              {showNow ? (
                <span
                  className={styles.ganttNow}
                  style={
                    {
                      "--gantt-now": `${(nowOffsetMinutes / GANTT_MINUTES) * 100}%`
                    } as CSSProperties
                  }
                  title="当前时间"
                />
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
