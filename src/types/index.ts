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

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export type LogContext = Record<string, unknown>;
