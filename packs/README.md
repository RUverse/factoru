# `packs/`

Versioned Factoru Gas City packs: agents, prompts, tools, doctor checks, and
Formula v2 workflows.

`packs/factoru-default` contains the fixed Project Manager and Software
Engineering role contracts plus the Blueprint workflow catalog. Version 0.4
adds `standard-build`, a thin overlay on the pinned upstream `gc.build-basic`,
while retaining `software-delivery` as the Fast Patch preset. Pack contents are
trusted, executable configuration; see the security rules in [AGENTS.md](../AGENTS.md).
