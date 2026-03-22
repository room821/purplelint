# Preset Purposes

ailint ships with 6 preset purpose files. Use them as starting points
and customize for your project.

## billing.yml

**Catches:** Revenue leaks from unbilled API calls

Ensures all external AI/API calls go through your designated SDK
for usage tracking and billing. Detects direct `fetch`/`axios` calls
to LLM provider endpoints and custom wrappers that bypass the SDK.

## layer-boundary.yml

**Catches:** Layer responsibility violations

Enforces clean architecture boundaries. Detects HTTP concerns leaking
into UseCases, ORM decorators in Domain Entities, and business logic
in Controllers.

## race-condition.yml

**Catches:** Unsafe concurrent state mutations

Finds read-modify-write patterns without transaction wrappers,
especially for balance, stock, counter, and quota values.

## auth-boundary.yml

**Catches:** Auth bypass vulnerabilities

Ensures authentication and authorization are handled exclusively
by designated middleware/guards, not scattered across handlers
and services.

## ai-code-quality.yml

**Catches:** AI over-engineering patterns

Flags common AI-generated code issues: single-implementation
abstractions, config systems for constants, error handling for
impossible cases, and speculative feature implementations.

## test-integrity.yml

**Catches:** Superficial tests with weak assertions

Detects tests with trivial assertions (`toBeDefined`),
implementation-coupled tests (mock call order verification),
and overly broad error catches.

## Using Presets

```bash
# Initialize with all presets
npx ailint init --preset all -y

# Initialize with specific presets
npx ailint init --preset billing,race-condition -y
```

After initialization, edit the purpose files to match your project's
specific patterns, SDK names, and directory structure.
