import type {
  AssignmentV2,
  DriverV2,
  EtaUnavailableReasonV2,
  OrderV2
} from "@/types/v2";

export const DISPATCHER_V2_NAVIGATION = [
  {
    entry: "map",
    href: "/admin/map/v2",
    label: "地图",
    title: "V2 调度地图"
  },
  {
    entry: "orders",
    href: "/admin/orders/v2",
    label: "订单",
    title: "V2 订单池"
  }
] as const;

const HOUR_MS = 60 * 60 * 1_000;
const GANTT_WINDOW_HOURS = 12;
const GANTT_WINDOW_MS = GANTT_WINDOW_HOURS * HOUR_MS;

export type OrderBusinessVisualKind = "PICKUP" | "RETURN";

export const ORDER_BUSINESS_META: Record<
  OrderV2["businessType"],
  {
    label: string;
    timeLabel: "取车时间" | "还车时间";
    visualKind: OrderBusinessVisualKind;
  }
> = {
  STORE_PICKUP: {
    label: "门店取车",
    timeLabel: "取车时间",
    visualKind: "PICKUP"
  },
  STORE_RETURN: {
    label: "门店还车",
    timeLabel: "还车时间",
    visualKind: "RETURN"
  },
  DOOR_DELIVERY: {
    label: "送车上门",
    timeLabel: "取车时间",
    visualKind: "PICKUP"
  },
  DOOR_PICKUP: {
    label: "上门取车",
    timeLabel: "还车时间",
    visualKind: "RETURN"
  }
};

export type OrderMapPoint = {
  visualKind: OrderBusinessVisualKind;
  markerKind: "order-pickup" | "order-return";
  title: "取车点" | "还车点";
  position: [number, number];
};

export function resolveOrderMapPoint(
  order: Pick<
    OrderV2,
    | "businessType"
    | "executionStatus"
    | "pickupLat"
    | "pickupLng"
    | "deliveryLat"
    | "deliveryLng"
  >
): OrderMapPoint | null {
  if (
    order.executionStatus === "COMPLETED" ||
    order.executionStatus === "CANCELLED"
  ) {
    return null;
  }

  const visualKind = ORDER_BUSINESS_META[order.businessType].visualKind;
  const lat = visualKind === "PICKUP" ? order.pickupLat : order.deliveryLat;
  const lng = visualKind === "PICKUP" ? order.pickupLng : order.deliveryLng;
  if (
    typeof lat !== "number" ||
    typeof lng !== "number" ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng)
  ) {
    return null;
  }

  return {
    visualKind,
    markerKind: visualKind === "PICKUP" ? "order-pickup" : "order-return",
    title: visualKind === "PICKUP" ? "取车点" : "还车点",
    position: [lng, lat]
  };
}

export function resolveOrderPromiseTimes(
  order: Pick<OrderV2, "businessType" | "promisedPickupAt">
) {
  const timeLabel = ORDER_BUSINESS_META[order.businessType].timeLabel;
  return {
    pickupAt: timeLabel === "取车时间" ? order.promisedPickupAt : undefined,
    returnAt: timeLabel === "还车时间" ? order.promisedPickupAt : undefined
  };
}

const orderSearchTime = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false
});

export type DispatcherConsoleEntry =
  (typeof DISPATCHER_V2_NAVIGATION)[number]["entry"];

export type TimelineSegmentKind =
  | "IDLE"
  | "DEADHEAD"
  | "SERVICE_MODULES"
  | "ORDER_DRIVE";

export type TimelineSegment = {
  kind: TimelineSegmentKind;
  minutes: number | null;
  unavailableReason?: EtaUnavailableReasonV2;
};

export type DriverGanttRow = {
  slot: "A" | "B" | "C";
  orderId?: string;
  orderNo?: string;
  businessType?: OrderV2["businessType"];
  feasibility?: OrderV2["feasibility"];
  assignment?: AssignmentV2;
};

export type DriverGanttBlock = {
  kind: TimelineSegmentKind;
  slot?: DriverGanttRow["slot"];
  orderId?: string;
  orderNo?: string;
  businessType?: OrderV2["businessType"];
  feasibility?: OrderV2["feasibility"];
  startAtMs: number;
  endAtMs: number;
  offsetMinutes: number;
  durationMinutes: number;
};

export type DriverGanttUnavailableRow = {
  slot: DriverGanttRow["slot"];
  orderId?: string;
  orderNo?: string;
  unavailableReason?: EtaUnavailableReasonV2;
};

export type DriverGantt = {
  windowStartMs: number;
  windowEndMs: number;
  focusOffsetMinutes: number;
  blocks: DriverGanttBlock[];
  unavailableRows: DriverGanttUnavailableRow[];
};

export type DriverPlanStatus =
  | "UNSELECTED"
  | "LOADING"
  | "READY"
  | "ERROR";

export type DriverGanttKnowledge = "CONFIRMED" | "UNKNOWN";

export function isLatestSnapshotRequest(
  requestId: number,
  latestRequestId: number
) {
  return requestId === latestRequestId;
}

export function resolveDriverPlanStatus({
  selectedDriverId,
  stateDriverId,
  stateStatus,
  responseDriverId
}: {
  selectedDriverId: string | null;
  stateDriverId: string | null;
  stateStatus: DriverPlanStatus;
  responseDriverId?: string;
}): DriverPlanStatus {
  if (!selectedDriverId) return "UNSELECTED";
  if (stateDriverId !== selectedDriverId) return "LOADING";
  if (stateStatus === "READY" && responseDriverId !== selectedDriverId) {
    return "LOADING";
  }
  return stateStatus;
}

export function shouldFetchOrderDetail(
  assignmentId: string | undefined,
  cachedAssignmentId: string | undefined
) {
  return Boolean(assignmentId && assignmentId !== cachedAssignmentId);
}

export function isCurrentAssignmentDetail(
  order: Pick<OrderV2, "currentAssignmentId">,
  detail:
    | { currentAssignment?: { id: string } }
    | null
    | undefined
) {
  return Boolean(
    order.currentAssignmentId &&
      detail?.currentAssignment?.id === order.currentAssignmentId
  );
}

function wholeMinutesBetween(startAt?: string, endAt?: string) {
  if (!startAt || !endAt) return null;
  const start = Date.parse(startAt);
  const end = Date.parse(endAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    return null;
  }
  return Math.round((end - start) / 60_000);
}

export function filterVisibleOrders(orders: readonly OrderV2[]) {
  return orders.filter((order) => !order.orderNo.startsWith("[G3E2E]"));
}

export function orderMatchesKeyword(order: OrderV2, keyword: string) {
  const normalizedKeyword = keyword.trim().toLocaleLowerCase("zh-CN");
  if (!normalizedKeyword) return true;
  const business = ORDER_BUSINESS_META[order.businessType];
  const promisedTime = Number.isFinite(Date.parse(order.promisedPickupAt))
    ? orderSearchTime.format(new Date(order.promisedPickupAt))
    : "";
  return [
    order.orderNo,
    order.pickupAddress,
    order.deliveryAddress,
    order.storeName,
    order.storeCode,
    business.label,
    business.timeLabel,
    promisedTime,
    promisedTime.replaceAll("/", "-"),
    order.promisedPickupAt
  ].some((value) =>
    value?.toLocaleLowerCase("zh-CN").includes(normalizedKeyword)
  );
}

export function sortOrdersForDispatchList(orders: readonly OrderV2[]) {
  return [...orders].sort((left, right) => {
    const leftRisk =
      left.feasibility === "AT_RISK" || left.feasibility === "INFEASIBLE";
    const rightRisk =
      right.feasibility === "AT_RISK" || right.feasibility === "INFEASIBLE";
    if (leftRisk !== rightRisk) return leftRisk ? -1 : 1;
    if (leftRisk) return 0;

    const leftTime = Date.parse(left.promisedPickupAt);
    const rightTime = Date.parse(right.promisedPickupAt);
    const normalizedLeftTime = Number.isFinite(leftTime)
      ? leftTime
      : Number.POSITIVE_INFINITY;
    const normalizedRightTime = Number.isFinite(rightTime)
      ? rightTime
      : Number.POSITIVE_INFINITY;
    return (
      normalizedLeftTime - normalizedRightTime ||
      left.orderNo.localeCompare(right.orderNo, "zh-CN")
    );
  });
}

export function filterDriversByKeyword(
  drivers: readonly DriverV2[],
  keyword: string,
  storeNameByCode: ReadonlyMap<string, string>
) {
  const normalizedKeyword = keyword.trim().toLocaleLowerCase("zh-CN");
  return drivers
    .filter((driver) => {
      if (!normalizedKeyword) return true;
      const storeName = storeNameByCode.get(driver.storeCode);
      return [driver.name, driver.storeCode, storeName].some((value) =>
        value?.toLocaleLowerCase("zh-CN").includes(normalizedKeyword)
      );
    })
    .sort((left, right) => {
      const storeComparison = left.storeCode.localeCompare(
        right.storeCode,
        "zh-CN"
      );
      return storeComparison || left.name.localeCompare(right.name, "zh-CN");
    });
}

export function resolveAssignedDriverId(
  orderId: string,
  drivers: readonly DriverV2[]
) {
  return drivers.find((driver) =>
    Object.values(driver.slots).some((slot) => slot?.orderId === orderId)
  )?.id;
}

export function deriveServiceModuleMinutes(assignment: AssignmentV2) {
  if (!assignment.etaAvailable) return null;
  const occupiedMinutes = wholeMinutesBetween(
    assignment.plannedPickupAt,
    assignment.plannedCompleteAt
  );
  const drivingMinutes = assignment.serviceEtaMinutes;
  if (
    occupiedMinutes === null ||
    drivingMinutes === undefined ||
    !Number.isFinite(drivingMinutes)
  ) {
    return null;
  }
  return Math.max(0, occupiedMinutes - drivingMinutes);
}

export function buildDriverGantt(
  rows: readonly DriverGanttRow[],
  nowMs = Date.now(),
  knowledge: DriverGanttKnowledge = "CONFIRMED"
): DriverGantt {
  const assignedRows = rows
    .filter((row): row is DriverGanttRow & { assignment: AssignmentV2 } =>
      Boolean(row.assignment)
    );
  const assignments = assignedRows
    .map((row) => ({
      ...row,
      departAtMs: Date.parse(row.assignment.plannedDepartAt ?? "")
    }))
    .filter((row) => Number.isFinite(row.departAtMs))
    .sort((left, right) => left.departAtMs - right.departAtMs);

  const windowStartMs =
    Math.floor(nowMs / HOUR_MS) * HOUR_MS - HOUR_MS;
  const windowEndMs = windowStartMs + GANTT_WINDOW_MS;
  const blocks: DriverGanttBlock[] = [];
  const unavailableRows: DriverGanttUnavailableRow[] = [];
  const unavailableKeys = new Set<string>();

  function addUnavailableRow(row: DriverGanttRow) {
    const key = `${row.slot}:${row.orderId ?? row.orderNo ?? "unknown"}`;
    if (unavailableKeys.has(key)) return;
    unavailableKeys.add(key);
    unavailableRows.push({
      slot: row.slot,
      orderId: row.orderId,
      orderNo: row.orderNo,
      unavailableReason: row.assignment?.etaUnavailableReason
    });
  }

  for (const row of rows) {
    if (row.orderId && !row.assignment) addUnavailableRow(row);
  }

  for (const row of assignedRows) {
    const departAtMs = Date.parse(row.assignment.plannedDepartAt ?? "");
    const pickupAtMs = Date.parse(row.assignment.plannedPickupAt ?? "");
    const completeAtMs = Date.parse(row.assignment.plannedCompleteAt ?? "");
    const hasUnknownSegment = buildTimelineSegments({
      assignment: row.assignment
    })
      .filter((segment) => segment.kind !== "IDLE")
      .some(
        (segment) =>
          segment.minutes === null || !Number.isFinite(segment.minutes)
      );
    if (
      !row.assignment.etaAvailable ||
      hasUnknownSegment ||
      !Number.isFinite(departAtMs) ||
      !Number.isFinite(pickupAtMs) ||
      !Number.isFinite(completeAtMs) ||
      pickupAtMs < departAtMs ||
      completeAtMs < pickupAtMs
    ) {
      addUnavailableRow(row);
    }
  }

  const hasUnknownOccupancy =
    knowledge === "UNKNOWN" || unavailableRows.length > 0;

  function addBlock(
    block: Omit<
      DriverGanttBlock,
      "startAtMs" | "endAtMs" | "offsetMinutes" | "durationMinutes"
    > & { startAtMs: number; endAtMs: number }
  ) {
    const startAtMs = Math.max(windowStartMs, block.startAtMs);
    const endAtMs = Math.min(windowEndMs, block.endAtMs);
    if (
      !Number.isFinite(startAtMs) ||
      !Number.isFinite(endAtMs) ||
      endAtMs <= startAtMs
    ) {
      return;
    }
    blocks.push({
      ...block,
      startAtMs,
      endAtMs,
      offsetMinutes: (startAtMs - windowStartMs) / 60_000,
      durationMinutes: (endAtMs - startAtMs) / 60_000
    });
  }

  let cursorAtMs = windowStartMs;

  for (const row of assignments) {
    const pickupAtMs = Date.parse(row.assignment.plannedPickupAt ?? "");
    const completeAtMs = Date.parse(row.assignment.plannedCompleteAt ?? "");
    if (
      !Number.isFinite(pickupAtMs) ||
      !Number.isFinite(completeAtMs) ||
      pickupAtMs < row.departAtMs ||
      completeAtMs < pickupAtMs
    ) {
      addUnavailableRow(row);
      continue;
    }

    const common = {
      slot: row.slot,
      orderId: row.orderId,
      orderNo: row.orderNo,
      businessType: row.businessType,
      feasibility: row.feasibility
    };

    const segments = buildTimelineSegments({
      assignment: row.assignment,
      cursorAt: new Date(cursorAtMs).toISOString()
    });
    const idleSegment = segments.find((segment) => segment.kind === "IDLE");
    if (
      !hasUnknownOccupancy &&
      idleSegment?.minutes &&
      idleSegment.minutes > 0
    ) {
      addBlock({
        kind: "IDLE",
        startAtMs: cursorAtMs,
        endAtMs: row.departAtMs
      });
    }

    const workSegments = segments.filter(
      (segment) => segment.kind !== "IDLE"
    );
    const hasUnavailableEta =
      !row.assignment.etaAvailable ||
      workSegments.some(
        (segment) =>
          segment.minutes === null || !Number.isFinite(segment.minutes)
      );
    if (hasUnavailableEta) {
      addUnavailableRow(row);
      cursorAtMs = Math.max(cursorAtMs, completeAtMs);
      continue;
    }

    let segmentStartAtMs = row.departAtMs;
    for (const segment of workSegments) {
      const segmentEndAtMs =
        segmentStartAtMs + (segment.minutes ?? 0) * 60_000;
      addBlock({
        ...common,
        kind: segment.kind,
        startAtMs: segmentStartAtMs,
        endAtMs: segmentEndAtMs
      });
      segmentStartAtMs = segmentEndAtMs;
    }
    cursorAtMs = Math.max(cursorAtMs, completeAtMs);
  }

  if (!hasUnknownOccupancy) {
    addBlock({
      kind: "IDLE",
      startAtMs: cursorAtMs,
      endAtMs: windowEndMs
    });
  }

  return {
    windowStartMs,
    windowEndMs,
    focusOffsetMinutes: 60,
    blocks,
    unavailableRows
  };
}

export function buildTimelineSegments({
  assignment,
  cursorAt
}: {
  assignment: AssignmentV2;
  cursorAt?: string;
}): TimelineSegment[] {
  const segments: TimelineSegment[] = [];
  const idleMinutes = wholeMinutesBetween(cursorAt, assignment.plannedDepartAt);
  if (idleMinutes !== null && idleMinutes > 0) {
    segments.push({ kind: "IDLE", minutes: idleMinutes });
  }

  if (!assignment.etaAvailable) {
    const unavailable = {
      minutes: null,
      unavailableReason: assignment.etaUnavailableReason
    };
    segments.push(
      { kind: "DEADHEAD", ...unavailable },
      { kind: "SERVICE_MODULES", ...unavailable },
      { kind: "ORDER_DRIVE", ...unavailable }
    );
    return segments;
  }

  segments.push({
    kind: "DEADHEAD",
    minutes:
      assignment.deadheadEtaMinutes !== undefined &&
      Number.isFinite(assignment.deadheadEtaMinutes)
        ? assignment.deadheadEtaMinutes
        : null
  });
  segments.push({
    kind: "SERVICE_MODULES",
    minutes: deriveServiceModuleMinutes(assignment)
  });
  segments.push({
    kind: "ORDER_DRIVE",
    minutes:
      assignment.serviceEtaMinutes !== undefined &&
      Number.isFinite(assignment.serviceEtaMinutes)
        ? assignment.serviceEtaMinutes
        : null
  });
  return segments;
}
