export type HaluoOrderBizType =
  | "store_pickup"
  | "store_return"
  | "door_delivery"
  | "door_pickup";

export type HaluoOrderPayload = {
  order_id: string;
  order_no: string;
  biz_type: HaluoOrderBizType;
  store_code: string;
  store_name: string;
  car_plate?: string;
  car_model?: string;
  pickup_address: string;
  pickup_lat?: number;
  pickup_lng?: number;
  return_address: string;
  return_lat?: number;
  return_lng?: number;
  appointment_time: string;
};
