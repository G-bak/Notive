// Placeholder for the mail provider adapter.
// Phase B step 4 (§13.6) wires the actual provider for verification
// and invitation emails. The provider choice itself is not in this lock
// (operations §4.1).

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export type MailSender = (message: MailMessage) => Promise<void>;

export const MAIL_PACKAGE_PLACEHOLDER = true as const;
