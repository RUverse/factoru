# `templates/`

Factoru Factory Template manifests that compose a pinned Gas City pack with
Worker Types, named model slots, tool/memory policies, Formula defaults, capsule
requirements, and UI metadata.

`software-project/template.json` is Factoru's built-in Milestone 3 Factory
Template. It composes the pinned `factoru-default` pack with the two initial
Worker Types, their named model slots, provenance-aware memory policy, Formula
binding points, and the serial Factory capacity invariant.

The manifest is trusted product configuration. Projects snapshot its version
and settings into Factoru's database when they are created; editing this file
does not silently mutate existing projects. Manifests must be pinned and
reviewed; see [AGENTS.md](../AGENTS.md).
