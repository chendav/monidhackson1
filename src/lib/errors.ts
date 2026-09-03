import type { ErrorCode } from "@/contracts";

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly retryable: boolean;
  readonly requestId: string;

  constructor(
    code: ErrorCode,
    message: string,
    options: {
      httpStatus?: number;
      retryable?: boolean;
      requestId?: string;
      cause?: unknown;
    } = {}
  ) {
    super(message, { cause: options.cause });
    this.name = "AppError";
    this.code = code;
    this.httpStatus = options.httpStatus ?? 400;
    this.retryable = options.retryable ?? false;
    this.requestId = options.requestId ?? crypto.randomUUID();
  }
}

export function asAppError(error: unknown, requestId = crypto.randomUUID()): AppError {
  if (error instanceof AppError) {
    return error;
  }

  return new AppError("ANALYSIS_INCOMPLETE", "The request could not be completed.", {
    httpStatus: 500,
    retryable: true,
    requestId,
    cause: error
  });
}

export function errorBody(error: AppError) {
  return {
    error: {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      request_id: error.requestId
    }
  } as const;
}
