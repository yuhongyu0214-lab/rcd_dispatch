export * from "./driver";
export * from "./order";

export type ApiSuccess<T> = {
  success: true;
  data: T;
  error: null;
  traceId: string;
};

export type ApiFailure = {
  success: false;
  data: null;
  error: string;
  traceId: string;
};
