import type {
  ApiErrorCodeV2,
  ApiErrorDetailsByCodeV2,
  ApiErrorV2
} from "@/types/v2";

export const API_ERROR_STATUS_V2 = {
  VALIDATION_FAILED: 400,
  ILLEGAL_TRANSITION: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  PLAN_VERSION_CONFLICT: 409,
  DUPLICATE_OPERATION: 409,
  PAYLOAD_TOO_LARGE: 413,
  LOCATION_INVALID: 422,
  INTERNAL_ERROR: 500,
  DEPENDENCY_UNAVAILABLE: 503
} as const satisfies Record<ApiErrorCodeV2, number>;

export function getApiErrorStatusV2(code: ApiErrorCodeV2): number {
  return API_ERROR_STATUS_V2[code];
}

export function createApiErrorV2<C extends ApiErrorCodeV2>(
  code: C,
  message: string,
  ...details: ApiErrorDetailsByCodeV2[C] extends undefined
    ? []
    : [ApiErrorDetailsByCodeV2[C]]
): ApiErrorV2<C> {
  const detail = details[0] as ApiErrorDetailsByCodeV2[C] | undefined;
  const error =
    detail === undefined
      ? { code, message }
      : { code, message, details: detail };

  return error as ApiErrorV2<C>;
}
