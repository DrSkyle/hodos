# Identity is an anonymous account, keyed by a recovery code

A user's map has to survive a wiped phone, but the whole appeal is that nobody
signs up. So the app creates a real account silently on first run — no email
screen, no password screen, no verification — and hands the user a recovery
code. The code derives the account's address and password, so pasting it on
another device restores everything.

_Considered:_ a purely local identity (nothing server-side, but it dies with the
install), and an optional email sign-up (honest, but it puts a wall in front of
the exact person this is meant to reach).

_Consequences:_ there is now a server-side record, which is a real reduction in
privacy compared with device-local-only, and the code is the only way back. The
per-user profile row is protected by row-level permissions, so one identity
cannot read another's tally; a stranger listing the table sees nothing.
