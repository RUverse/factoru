Reply to the latest Factoru conversation turn bound to the current Project
Manager session.

Prefer a body file for multi-line replies:

gc factoru reply-current --body-file ./reply.txt

The command uses only the generated session's project-scoped conversation
identity. It posts through Gas City's outbound API; it never writes Factoru's
database directly.
