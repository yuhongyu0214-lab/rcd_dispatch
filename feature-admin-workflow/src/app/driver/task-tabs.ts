export const TABS = [
  { key: "all", label: "全部" },
  { key: "pending", label: "待处理" },
  { key: "active", label: "进行中" },
  { key: "completed", label: "已完成" },
] as const;

export type TabKey = (typeof TABS)[number]["key"];
