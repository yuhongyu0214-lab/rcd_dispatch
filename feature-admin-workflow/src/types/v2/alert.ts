import type {
  DispatchAlertResolvedByV2,
  DispatchAlertStatusV2,
  DispatchAlertTypeV2,
  IsoDateTimeStringV2
} from "./domain";

export type DispatchAlertV2 = {
  id: string;
  orderId: string;
  type: DispatchAlertTypeV2;
  status: DispatchAlertStatusV2;
  slackMinutesAtCreate: number;
  createdAt: IsoDateTimeStringV2;
  resolvedAt?: IsoDateTimeStringV2;
  resolvedBy?: DispatchAlertResolvedByV2;
  historyRetained: true;
};
