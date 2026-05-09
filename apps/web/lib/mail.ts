// Process-global mail adapter.
//
// In tests, swap the adapter via `setMailAdapter` (or set
// NOTIVE_USE_INMEMORY_MAIL=1 before module load) so integration tests
// can capture verification / reset emails.

import { ConsoleMailAdapter, InMemoryMailAdapter, type MailAdapter } from "@notive/mail";

let adapter: MailAdapter =
  process.env.NOTIVE_USE_INMEMORY_MAIL === "1"
    ? new InMemoryMailAdapter()
    : new ConsoleMailAdapter();

export function getMailAdapter(): MailAdapter {
  return adapter;
}

export function setMailAdapter(next: MailAdapter): void {
  adapter = next;
}
