# `templates/`

Factoru Project Blueprint manifests that compose a pinned Gas City pack with
Team profiles, named model slots, tool/memory policies, allowed Formula Presets,
a recommended default, capsule requirements, and UI metadata.

`software-project/template.json` is the built-in Standard Software Project
Blueprint. `fast-patch/template.json` provides the alternative ready default.
Both compose the pinned `factoru-default` pack with the two initial Team
profiles, their named model slots, provenance-aware memory policy, Formula
Preset catalog, and the serial Factory capacity invariant.

The manifest is trusted product configuration. Projects snapshot its version
and settings into Factoru's database when they are created; editing this file
does not silently mutate existing projects. Manifests must be pinned and
reviewed; see [AGENTS.md](../AGENTS.md).
