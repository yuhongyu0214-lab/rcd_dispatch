import type {
  EtaUnavailableReasonV2,
  GeoPointV2,
  IsoDateTimeStringV2
} from "./domain";

export type EtaLegV2 = "DEADHEAD" | "SERVICE";

export type EtaRequestV2 = {
  leg: EtaLegV2;
  origin: GeoPointV2;
  destination: GeoPointV2;
};

export type EtaResultV2 =
  | {
      leg: EtaLegV2;
      etaAvailable: true;
      etaMinutes: number;
      calculatedAt: IsoDateTimeStringV2;
      etaUnavailableReason?: never;
    }
  | {
      leg: EtaLegV2;
      etaAvailable: false;
      etaMinutes?: never;
      calculatedAt: IsoDateTimeStringV2;
      etaUnavailableReason: EtaUnavailableReasonV2;
    };
