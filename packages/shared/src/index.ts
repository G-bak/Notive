export const APP_NAME = "notive";

export type Role = "Viewer" | "Editor" | "Manager" | "Admin";

export type ErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR"
  | "SERVICE_UNAVAILABLE";

export type ForbiddenReason =
  | "role_required"
  | "last_admin_protection"
  | "membership_required"
  | "feature_disabled";

export interface ApiError {
  code: ErrorCode;
  message: string;
  reasonCode?: ForbiddenReason | string;
  details?: Record<string, unknown>;
}
