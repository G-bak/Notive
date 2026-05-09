// Notive auth package — Phase B step 4.
//
// Surface kept narrow: API routes import these named functions and
// translate AuthError into HTTP responses. The cookie name and the
// HttpOnly/SameSite policy are owned by the apps/web layer; this
// package returns raw tokens, not Set-Cookie strings.

export { AuthError } from "./errors.js";
export type { AuthErrorCode } from "./errors.js";

export {
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
  hashPassword,
  validatePasswordPolicy,
  verifyPassword,
} from "./password.js";

export { generateToken, hashToken } from "./tokens.js";

export {
  createSession,
  revokeAllSessionsForUser,
  revokeSessionByToken,
  validateSession,
} from "./session.js";
export type { CreateSessionResult, SessionTtl, ValidatedSession } from "./session.js";

export {
  resendVerification,
  resendVerificationInputSchema,
  signup,
  signupInputSchema,
  verifyEmail,
  verifyEmailInputSchema,
} from "./signup.js";
export type {
  ResendOutcome,
  ResendVerificationInput,
  SignupInput,
  SignupOptions,
  SignupResult,
  VerifyEmailInput,
} from "./signup.js";

export { login, loginInputSchema, logout } from "./login.js";
export type { LoginInput, LoginOptions } from "./login.js";

export {
  confirmPasswordReset,
  confirmResetInputSchema,
  requestPasswordReset,
  requestResetInputSchema,
} from "./password-reset.js";
export type {
  ConfirmResetInput,
  PasswordResetOptions,
  RequestResetInput,
  RequestResetResult,
} from "./password-reset.js";
