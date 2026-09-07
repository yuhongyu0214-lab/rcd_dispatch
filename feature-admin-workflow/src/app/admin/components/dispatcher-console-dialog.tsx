"use client";

import { useEffect, useRef, type KeyboardEvent } from "react";

import type { DriverV2, OrderV2 } from "@/types/v2";

import styles from "./dispatcher-console.module.css";

export type DialogKind = "ASSIGN" | "REASSIGN" | "WITHDRAW" | "UNLOCK" | "EDIT";

export type DialogState = {
  kind: DialogKind;
  targetDriverId: string;
  reason: string;
  promisedPickupAt: string;
  pickupAddress: string;
  deliveryAddress: string;
};

const DEFAULT_OPERATION_REASONS: Record<DialogKind, string> = {
  ASSIGN: "调度员人工分配",
  REASSIGN: "调度员人工改派",
  WITHDRAW: "调度员人工撤回",
  UNLOCK: "调度员人工解锁",
  EDIT: "调度员修改订单资料"
};

export function resolveOperationReason(kind: DialogKind, reason: string) {
  return reason.trim() || DEFAULT_OPERATION_REASONS[kind];
}

export function dialogTitle(kind: DialogKind) {
  return {
    ASSIGN: "人工分配订单",
    REASSIGN: "改派订单",
    WITHDRAW: "撤回到未分配池",
    UNLOCK: "解除人工锁定",
    EDIT: "修改订单资料"
  }[kind];
}

export function resolveDialogFieldLabels(
  businessType: OrderV2["businessType"]
) {
  const returnWork =
    businessType === "STORE_RETURN" || businessType === "DOOR_PICKUP";
  return returnWork
    ? {
        promisedAt: "承诺还车时间（上海时区）",
        pickupAddress: "车辆所在地点",
        deliveryAddress: "还车地点"
      }
    : {
        promisedAt: "承诺取车时间（上海时区）",
        pickupAddress: "车辆取车地点",
        deliveryAddress: "送车地点"
      };
}

export function DispatcherConsoleDialog({
  dialog,
  orderNo,
  businessType,
  currentDriverId,
  eligibleDrivers,
  error,
  submitting,
  onChange,
  onClose,
  onSubmit
}: {
  dialog: DialogState;
  orderNo: string;
  businessType: OrderV2["businessType"];
  currentDriverId?: string;
  eligibleDrivers: readonly DriverV2[];
  error: string | null;
  submitting: boolean;
  onChange: (next: DialogState) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const modalRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const fieldLabels = resolveDialogFieldLabels(businessType);

  useEffect(() => {
    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const modal = modalRef.current;
    const initialFocus = modal?.querySelector<HTMLElement>(
      '[data-autofocus="true"]'
    );
    initialFocus?.focus();

    return () => {
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, []);

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onCloseRef.current();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    );
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div className={styles.modalBackdrop} role="presentation">
      <section
        ref={modalRef}
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-label={dialogTitle(dialog.kind)}
        onKeyDown={handleKeyDown}
      >
        <header>
          <div>
            <span>调度操作 · {orderNo}</span>
            <h2>{dialogTitle(dialog.kind)}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </header>
        <div className={styles.modalBody}>
          {dialog.kind === "ASSIGN" || dialog.kind === "REASSIGN" ? (
            <label>
              <span>目标司机</span>
              <select
                data-autofocus="true"
                value={dialog.targetDriverId}
                onChange={(event) =>
                  onChange({ ...dialog, targetDriverId: event.target.value })
                }
              >
                <option value="">请选择司机</option>
                {eligibleDrivers
                  .filter((driver) => driver.id !== currentDriverId)
                  .map((driver) => (
                    <option key={driver.id} value={driver.id}>
                      {driver.name} · {driver.storeCode} · v{driver.planVersion}
                    </option>
                  ))}
              </select>
              <small>
                仅列出当班、可用且位置实时的司机；槽位由服务端选择。
              </small>
            </label>
          ) : null}

          {dialog.kind === "EDIT" ? (
            <>
              <label>
                <span>{fieldLabels.promisedAt}</span>
                <input
                  data-autofocus="true"
                  type="datetime-local"
                  value={dialog.promisedPickupAt}
                  onChange={(event) =>
                    onChange({
                      ...dialog,
                      promisedPickupAt: event.target.value
                    })
                  }
                />
              </label>
              <label>
                <span>{fieldLabels.pickupAddress}</span>
                <input
                  value={dialog.pickupAddress}
                  onChange={(event) =>
                    onChange({ ...dialog, pickupAddress: event.target.value })
                  }
                />
              </label>
              <label>
                <span>{fieldLabels.deliveryAddress}</span>
                <input
                  value={dialog.deliveryAddress}
                  onChange={(event) =>
                    onChange({ ...dialog, deliveryAddress: event.target.value })
                  }
                />
              </label>
              <p className={styles.modalNote}>
                地址变化由服务端重新地理编码；失败时不会写入半成品地址。
              </p>
            </>
          ) : null}

          <label>
            <span>操作原因（选填）</span>
            <textarea
              data-autofocus={
                dialog.kind !== "ASSIGN" &&
                dialog.kind !== "REASSIGN" &&
                dialog.kind !== "EDIT"
                  ? "true"
                  : undefined
              }
              value={dialog.reason}
              onChange={(event) =>
                onChange({ ...dialog, reason: event.target.value })
              }
              placeholder="未填写时将记录标准操作原因"
              rows={3}
            />
          </label>
          {error ? (
            <p className={styles.modalError} role="alert">
              {error}
            </p>
          ) : null}
        </div>
        <footer>
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={onClose}
          >
            取消
          </button>
          <button
            type="button"
            className={styles.primaryButton}
            onClick={onSubmit}
            disabled={submitting}
          >
            {submitting ? "提交中…" : "确认并立即重算"}
          </button>
        </footer>
      </section>
    </div>
  );
}
