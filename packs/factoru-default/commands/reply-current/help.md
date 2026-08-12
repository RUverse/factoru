Reply to the latest Factoru conversation turn bound to the current Project
Manager session.

Prefer a body file for multi-line replies:

gc factoru reply-current --conversation-id <conversation-id> --body-file ./reply.txt

The command uses only the generated session's project-scoped conversation
identity. The optional conversation ID emitted by Gas City's delivery reminder
must match that session identity. The command posts through Gas City's outbound
API; it never writes Factoru's database directly.
