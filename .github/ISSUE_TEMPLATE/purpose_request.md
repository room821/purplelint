---
name: Purpose request
about: Submit a new purpose file for the community hub
title: "[Purpose] "
labels: purpose-hub
assignees: ""
---

## Purpose Info

- **ID** (kebab-case, e.g. `pci-compliance`):
- **Category** (e.g. payment, auth, database, security, performance):
- **Language/Stack** (e.g. TypeScript, Python, any):

## Purpose YAML

Paste your purpose file below. See [Purpose File Anatomy](https://github.com/room821/purplelint#purpose-file-anatomy) for the schema.

```yaml
id: your-purpose-id
purpose: >
  Describe what this purpose guards and why it matters.
  Include the correct sequence of operations if applicable.
violations:
  - "SEQUENCE BREAK: describe the ordering violation"
  - "MISSING STEP: describe what's missing"
  - "BOUNDARY: describe the boundary violation"
good_examples:
  - title: "Correct: describe the correct pattern"
    code: |
      // correct code here
bad_examples:
  - title: "Broken: describe the anti-pattern"
    code: |
      // broken code here
context_hint: >
  What should the LLM look for when evaluating code against this purpose?
```

## Why This Matters

What real-world bug, incident, or risk does this purpose prevent?

## Validation

- [ ] Tested with `npx purplelint validate`
- [ ] Tested against real code with `npx purplelint run --purpose your-id`
- [ ] No overlap with existing built-in detectors
