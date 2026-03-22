# ailint

> Purpose-driven architecture linting protocol. Agent-agnostic. Open spec.

**ailint doesn't lint your code style. It guards your architecture intent.**

ESLint catches semicolons. `architecture-linter` catches import direction.
**ailint catches "this code will lose us money."**

## The Problem

Your team wrote architecture rules. They live in a wiki nobody reads.
PRs get rejected for violations nobody can catch automatically.
AI agents ship code fast — but they don't know *why* your layers exist.

## The Solution

Write **purposes**, not rules. Each purpose explains *why* a constraint exists:

```yaml
# ailint/billing.yml
id: billing
purpose: >
  All AI calls must go through our SDK for usage tracking.
  Direct API calls bypass billing and cause revenue leakage.
violations:
  - Direct fetch/axios calls to LLM endpoints
  - Custom wrappers that bypass the SDK
good_examples: [...]
bad_examples: [...]
```

Then check against them before you build:

```bash
$ npx ailint run -i

┌  ailint — Architecture Checkpoint
│
◆  Select purposes to check:
│  ◼ billing — All AI calls must go through our SDK
│  ◻ layer-boundary — Each layer handles its own responsibility
│  ◼ race-condition — Shared state mutations need transactions
└
```

## Quick Start

```bash
# Initialize ailint in your project
npx ailint init

# Validate your purpose files
npx ailint validate

# Run architecture check (interactive)
npx ailint run -i

# Run specific purpose
npx ailint run --purpose billing
```

## Key Design Decisions

### Purpose = Execution Unit
Not rules. A "purpose" is *why* a constraint exists. This means the lint
doubles as your architecture documentation.

### Language-Agnostic
ailint works with **any language** — TypeScript, Python, Go, Java, Rust, etc.
The `scope` field uses glob patterns: `"src/**/*.py"`, `"**/*.go"`, `"**/*.java"`.
Purposes are evaluated by LLMs that understand any language.

### Agent-Agnostic
ailint produces structured prompts. Any AI agent can execute them:

**Claude Code:**
```bash
npx ailint init
npx ailint run --purpose billing --output prompt | claude
```

**Codex (OpenAI):**
```bash
npx ailint run --all --output prompt | codex
```

**Cursor / Windsurf:**
Add to `.cursorrules` or `.windsurfrules`:
```
Before building, read the /ailint directory and evaluate changes against each purpose.
```

**Custom CI (GitHub Actions):**
```yaml
- run: npx ailint run --all --output json > ailint-results.json
- run: cat ailint-results.json | your-model-runner
```

### Selective Execution
Not every commit. Not every purpose. You choose.
This is an architecture checkpoint, not a style cop.

### "When in doubt, pass"
The protocol explicitly instructs models to only flag clear violations.
False positives kill trust faster than missed bugs.

## Presets

ailint ships with 6 battle-tested purpose presets:

| Preset | Catches |
|--------|---------|
| `billing` | Revenue leaks from unbilled API calls |
| `layer-boundary` | Layer responsibility violations |
| `race-condition` | Unsafe concurrent state mutations |
| `auth-boundary` | Auth bypass vulnerabilities |
| `ai-code-quality` | AI over-engineering patterns |
| `test-integrity` | Superficial tests with weak assertions |

## Directory Structure

```
# Single repo
my-app/
└── ailint/
    ├── ailint.yml
    ├── billing.yml
    └── layer-boundary.yml

# Monorepo — shared + package-level
monorepo/
├── ailint/                  # shared across all packages
│   ├── ailint.yml
│   └── billing.yml
└── packages/
    └── api/
        └── ailint/          # api-specific additions
            └── auth-boundary.yml
```

Lookup is cascading (like `.gitignore`): closest `ailint/` folder wins,
inherits from parent unless `inherit: false`.

## Spec

Full protocol specification: [RFC.md](./docs/RFC.md)

## Philosophy

ailint is a **protocol**, not a product. The spec is open.
Build your own runner. Share your purposes. Make architecture enforceable.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

MIT

---

If ailint helps your team, [star us on GitHub](https://github.com/room821/ailint)!
