// Mail provider abstraction for Phase B step 4.
//
// In MVP, the actual SMTP/transactional provider is not yet decided
// (see ops doc §4.1). We expose a small interface plus two adapters:
//   - ConsoleMailAdapter: default, prints messages to stderr. Used in
//     dev when no provider is wired.
//   - InMemoryMailAdapter: captures messages in a list. Used in tests
//     so integration tests can extract verification / reset tokens
//     from the email body.
//
// Auth flows depend only on `MailAdapter`. Never import the concrete
// adapter directly from app code — pass it in.

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface MailAdapter {
  send(message: MailMessage): Promise<void>;
}

/** Default adapter. Logs to stderr; does not deliver. */
export class ConsoleMailAdapter implements MailAdapter {
  async send(message: MailMessage): Promise<void> {
    // Subject only — body may contain a token. Tokens must not land in
    // logs (auth policy). Tests use InMemoryMailAdapter to capture
    // token-bearing bodies; production wiring uses a real provider.
    // eslint-disable-next-line no-console
    console.error(`[mail] to=${message.to} subject=${message.subject}`);
  }
}

/** In-memory adapter. Tests read `messages` to extract token strings. */
export class InMemoryMailAdapter implements MailAdapter {
  readonly messages: MailMessage[] = [];

  async send(message: MailMessage): Promise<void> {
    this.messages.push({ ...message });
  }

  /** Find the most recent message sent to `to`. */
  lastTo(to: string): MailMessage | undefined {
    for (let i = this.messages.length - 1; i >= 0; i -= 1) {
      const m = this.messages[i];
      if (m && m.to === to) {
        return m;
      }
    }
    return undefined;
  }

  reset(): void {
    this.messages.length = 0;
  }
}

// ----- templates ------------------------------------------------------
//
// Body strings include the verification or reset URL with the raw token
// as a query string. `appBaseUrl` is the validated `APP_BASE_URL` env.

export interface VerifyEmailParams {
  appBaseUrl: string;
  email: string;
  token: string;
  ttlHours: number;
}

export function buildVerifyEmailMessage(params: VerifyEmailParams): MailMessage {
  const url = `${trimTrailingSlash(params.appBaseUrl)}/verify-email?token=${encodeURIComponent(params.token)}`;
  return {
    to: params.email,
    subject: "[Notive] Verify your email",
    text:
      `Welcome to Notive.\n\n` +
      `Confirm this email address by visiting:\n${url}\n\n` +
      `This link expires in ${params.ttlHours} hour(s).`,
  };
}

export interface PasswordResetParams {
  appBaseUrl: string;
  email: string;
  token: string;
  ttlMinutes: number;
}

export function buildPasswordResetMessage(params: PasswordResetParams): MailMessage {
  const url = `${trimTrailingSlash(params.appBaseUrl)}/password-reset?token=${encodeURIComponent(params.token)}`;
  return {
    to: params.email,
    subject: "[Notive] Reset your password",
    text:
      `A password reset was requested for your Notive account.\n\n` +
      `If this was you, visit:\n${url}\n\n` +
      `This link expires in ${params.ttlMinutes} minute(s). ` +
      `If you did not request this, you can ignore this email.`,
  };
}

export interface InvitationParams {
  appBaseUrl: string;
  email: string;
  organizationName: string;
  inviterName: string;
  token: string;
  ttlDays: number;
}

export function buildInvitationMessage(params: InvitationParams): MailMessage {
  const url = `${trimTrailingSlash(params.appBaseUrl)}/invitations/accept?token=${encodeURIComponent(params.token)}`;
  return {
    to: params.email,
    subject: `[Notive] You've been invited to ${params.organizationName}`,
    text:
      `${params.inviterName} invited you to join ${params.organizationName} on Notive.\n\n` +
      `Accept the invitation by visiting:\n${url}\n\n` +
      `This invitation expires in ${params.ttlDays} day(s).`,
  };
}

function trimTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}
