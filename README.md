<p align="center">
  <strong>purplelint</strong><br>
  Purpose-driven architecture linting. Agent-agnostic. Open spec.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/purplelint"><img src="https://img.shields.io/npm/v/purplelint.svg" alt="npm version"></a>
  <a href="https://github.com/room821/purplelint/actions"><img src="https://github.com/room821/purplelint/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/room821/purplelint/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/purplelint.svg" alt="license"></a>
  <a href="https://www.npmjs.com/package/purplelint"><img src="https://img.shields.io/npm/dm/purplelint.svg" alt="downloads"></a>
</p>

---

ESLint catches semicolons. ArchUnit catches import direction.

**purplelint catches "this code will lose us money."**

---

## The Problem

Your payment webhook processes the event before persisting it. A retry fires. The customer gets charged twice.

Your junior dev calls `jwt.decode()` instead of `jwt.verify()`. Every request is now authenticated with unsigned tokens.

Your architecture rules exist in a wiki nobody reads, enforced by PR reviews nobody has time for. AI agents ship code fast — but they don't know *why* your layers exist or *what order* your payment flow requires.

Static linters can't catch these. They don't understand intent.

## What purplelint Does

purplelint guards **architectural intent**, not code style. You define **purposes** — each one explains *why* a constraint exists, what the correct sequence of operations is, and what a violation looks like. Then any LLM evaluates your code against them.

```yaml
# purplelint/billing-tracking.yml
id: billing-tracking
purpose: >
  Payment flows must follow a strict sequence.
  Webhook: verify signature -> persist raw event -> deduplicate -> process -> acknowledge.
  Any step out of order causes double charges or lost events.
violations:
  - "SEQUENCE BREAK: Webhook processes event before persisting it"
  - "MISSING STEP: Webhook handler without signature verification as the FIRST operation"
  - "MISSING STEP: Payment mutation without idempotency key"
good_examples:
  - title: "Correct sequence: webhook flow"
    code: |
      // 1. VERIFY — always first
      const event = stripe.webhooks.constructEvent(body, sig, secret);
      // 2. PERSIST — store raw event before any processing
      await db.webhookEvent.create({ eventId: event.id, raw: body });
      // 3. DEDUPLICATE — skip if already processed
      if (await isProcessed(event.id)) return res.json({ received: true });
      // 4. PROCESS — business logic
      await paymentService.fulfill(event);
      // 5. ACKNOWLEDGE
      await markProcessed(event.id);
bad_examples:
  - title: "Broken sequence: process before store"
    code: |
      const event = JSON.parse(req.body); // no signature verification!
      await updateSubscription(event.data); // processes before storing
      await db.webhookEvent.create({ data: event }); // crash = event lost
```

This isn't a regex. It's a sequence diagram encoded as a purpose, evaluated by an LLM that understands control flow.

## Quick Start

```bash
npx purplelint init
```

That's it. purplelint scans your project, detects your stack, and generates purpose files tailored to what you actually use:

```
┌  purplelint — Architecture Checkpoint
│
◇  Found 9 architecture pattern(s)
│
◆  Generate purpose files for:
│  ◼ billing-tracking — Payment flows must follow a strict sequence
│  ◼ auth-boundary — Auth must follow a strict sequence per request
│  ◼ transaction-safety — Database operations require transactions
│  ◼ layer-boundary — Layer structure must be maintained
│  ◼ test-integrity — Tests must have meaningful assertions
│  ◼ design-system — Components must use the design system
│  ◼ error-handling — Errors must be handled explicitly
│  ◼ secret-safety — Secrets must never appear in source code
│  ◼ api-contract — API endpoints must validate input
└
```

Then run checks:

```bash
# Interactive — pick which purposes to check
npx purplelint run -i

# Single purpose
npx purplelint run --purpose billing-tracking

# All purposes
npx purplelint run --all

# Validate purpose file schema
npx purplelint validate

# List configured purposes
npx purplelint list
```

## Auto-Detection: 11 Built-in Detectors

`purplelint init` doesn't dump a generic config. It reads your `package.json`, `requirements.txt`, `pyproject.toml`, and source files, then generates only the purposes that apply to your stack.

| Detector | What It Guards | Triggered By |
|---|---|---|
| **billing-tracking** | Payment sequence: verify -> persist -> deduplicate -> process -> acknowledge | Stripe, Paddle, LemonSqueezy, or payment patterns in code |
| **auth-boundary** | Auth sequence: extract -> verify -> validate -> attach -> check | jsonwebtoken, jose, passport, next-auth, or JWT patterns |
| **transaction-safety** | Transaction wrapping, unbounded queries, soft delete | Prisma, TypeORM, Drizzle, SQLAlchemy, Django ORM |
| **layer-boundary** | Controller/service/repo separation of concerns | Express/Fastify routes, Django views, Spring controllers |
| **test-integrity** | Weak assertions, snapshot abuse, mock anti-patterns | Jest, Vitest, pytest, or test files detected |
| **design-system** | Raw Tailwind colors, inline styles, bypassed component library | Tailwind, styled-components, Chakra UI, Material UI |
| **error-handling** | Empty catch blocks, swallowed promises, console.log errors | Any project with try/catch or .catch() patterns |
| **secret-safety** | Hardcoded API keys, .env in git, secrets in logs | Any project (always relevant) |
| **api-contract** | Missing input validation, inconsistent responses, stack trace leaks | Express, Fastify, Django REST, Spring Boot |
| **performance** | N+1 queries, await-in-loop, unbounded queries | ORM or database usage detected |
| **race-condition** | Unsafe concurrent state mutations | Concurrent processing patterns detected |

**Language-agnostic.** Works with TypeScript, Python, Go, Java, Rust, Ruby, and mixed-language monorepos.

## Sequence Diagrams as Lint Rules

Most linters check syntax. purplelint checks **sequences** — the order operations must happen.

```
Payment Webhook (correct sequence):

  Client          Server           Database         Payment Provider
    |                |                |                    |
    |   POST /webhook |                |                    |
    |--------------->|                |                    |
    |                | 1. VERIFY sig  |                    |
    |                |--------------->|                    |
    |                | 2. PERSIST raw |                    |
    |                |--------------->|                    |
    |                | 3. DEDUPLICATE |                    |
    |                |<---------------|                    |
    |                | 4. PROCESS     |                    |
    |                |--------------->|                    |
    |                | 5. ACKNOWLEDGE |                    |
    |   200 OK       |                |                    |
    |<---------------|                |                    |
```

When your code does step 4 before step 2, purplelint flags it as `SEQUENCE BREAK`. Not a style issue. A "you will lose money" issue.

The same applies to auth flows (decode before verify = accept unsigned tokens) and database operations (read before lock = race condition).

## Agent-Agnostic

purplelint produces structured prompts. Pipe them to any LLM.

**Claude Code:**
```bash
npx purplelint run --purpose billing-tracking --output prompt | claude
```

**Codex (OpenAI):**
```bash
npx purplelint run --all --output prompt | codex
```

**Cursor / Windsurf:**

Add to `.cursorrules` or `.windsurfrules`:
```
Before building, read the /purplelint directory and evaluate changes against each purpose.
```

**GitHub Actions CI:**
```yaml
- run: npx purplelint run --all --output json > purplelint-results.json
- run: cat purplelint-results.json | your-model-runner
```

**Any agent, any model.** purplelint is the protocol. Your LLM is the evaluator.

## Directory Structure

```
# Single repo
my-app/
└── purplelint/
    ├── purplelint.yml          # config + purpose index
    ├── billing-tracking.yml    # payment sequence rules
    └── auth-boundary.yml       # auth flow rules

# Monorepo — cascading lookup (like .gitignore)
monorepo/
├── purplelint/                 # shared across all packages
│   ├── purplelint.yml
│   └── billing-tracking.yml
└── packages/
    ├── api/
    │   └── purplelint/         # api-specific overrides
    │       └── auth-boundary.yml
    └── worker/
        └── purplelint/         # worker-specific
            └── race-condition.yml
```

Closest `purplelint/` folder wins. Inherits from parent unless `inherit: false`.

## Purpose File Anatomy

```yaml
id: auth-boundary
purpose: >
  Auth must follow a strict sequence per request: extract token ->
  verify signature -> validate expiry -> attach user context ->
  check permissions. This runs ONCE in middleware, never in handlers.
violations:
  - "SEQUENCE BREAK: Token used before signature verification"
  - "MISSING STEP: Token expiry not validated"
  - "BOUNDARY: Token parsing outside auth middleware"
  - "LEAK: Error messages revealing whether email exists"
good_examples:
  - title: "Correct: middleware auth pipeline"
    code: |
      // Step 1: EXTRACT
      const token = req.headers.authorization?.split(" ")[1];
      // Step 2: VERIFY signature (not decode!)
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      // Step 3: VALIDATE expiry
      if (decoded.exp < Date.now() / 1000) throw new TokenExpiredError();
      // Step 4: ATTACH
      req.user = { id: decoded.sub, role: decoded.role };
bad_examples:
  - title: "Broken: decode without verify, auth in handler"
    code: |
      app.get("/api/data", (req, res) => {
        const token = req.headers.authorization?.split(" ")[1];
        const user = jwt.decode(token); // accepts UNSIGNED tokens!
        if (user.role !== "admin") return res.status(403);
      });
context_hint: >
  Trace the auth sequence: extract -> verify -> validate expiry ->
  attach context -> check permissions. Flag jwt.decode (not verify),
  missing exp checks, and auth logic outside middleware.
exceptions:
  - "Test files (*.test.ts, *.spec.ts)"
  - "Auth middleware implementation itself"
```

Each purpose is both a lint rule AND documentation. New engineers read these and understand *why* the architecture exists, not just what the rules are.

## Design Philosophy

**Protocol, not product.** The spec is open. Build your own runner. Share your purposes across teams.

**"When in doubt, pass."** The prompt explicitly instructs models to only flag clear violations. False positives kill trust faster than missed bugs.

**Selective execution.** Not every commit. Not every purpose. You choose what to check and when. This is an architecture checkpoint, not a style cop.

**Sequence-first violations.** Instead of "don't do X", purplelint says "step 4 must come after step 2." Order-of-operations bugs cause the most expensive incidents.

## Why Not Just...

**"...use ESLint / Biome / Ruff?"**

Those catch syntax and style. `no-unused-vars` is useful. But no ESLint rule can express "webhook must persist before processing" or "auth must verify before decode." purplelint operates at the architecture level, where the expensive bugs live.

**"...use ArchUnit / ArchGuard?"**

ArchUnit is Java-only and checks import/dependency graphs. It can't evaluate control flow sequences or understand *why* a constraint exists. purplelint is language-agnostic and uses LLMs to understand intent, not just structure.

**"...write custom ESLint rules?"**

You could. For one language. It takes days per rule, requires AST knowledge, and produces rules nobody maintains. A purplelint purpose file takes 5 minutes to write, works across languages, and reads like documentation.

**"...just put it in the PR review checklist?"**

You already tried that. It didn't scale past 3 engineers. purplelint automates the architectural checks that senior engineers do manually, so reviews focus on design decisions instead of catching known anti-patterns.

**"...add it to .cursorrules?"**

Good start — and purplelint works with Cursor. But `.cursorrules` is unstructured prose. purplelint gives you a schema (violations, examples, sequences, exceptions), works in CI, and produces structured output you can aggregate across a team.

## CLI Reference

```
purplelint <command> [options]

Commands:
  init              Scan project and generate purpose files
  validate          Validate purpose files against schema
  run               Run architecture checks
  list              List configured purposes

Options:
  --help, -h        Show help
  --version         Show version

init options:
  --dir <path>      Output directory (default: ./purplelint)
  -y, --yes         Accept all defaults

run options:
  -i, --interactive Select purposes interactively
  --purpose <id>    Run a single purpose
  --all             Run all configured purposes
  --output <format> Output format: prompt, json, markdown
  --diff <ref>      Git diff reference (default: staged changes)
  --context <mode>  Context strategy: diff, diff+imports
  --dir <path>      Config directory

validate options:
  --dir <path>      Config directory
```

## Requirements

- Node.js >= 18
- npm, npx, or any Node package manager

No runtime dependencies on any specific LLM provider. purplelint generates prompts — you choose who evaluates them.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

```bash
git clone https://github.com/room821/purplelint.git
cd purplelint
npm install
npm test
npm run build
```

**Adding a new detector:** Create a detector in `src/core/scanner.ts`, add a preset in `presets/`, and add tests. See existing detectors for the pattern.

**Sharing purpose files:** Purpose files are just YAML. Copy them between projects, publish them as gists, or contribute them upstream.

## License

[MIT](./LICENSE) -- Room821

---

If purplelint saves your team from a sequence bug, [star it on GitHub](https://github.com/room821/purplelint).
