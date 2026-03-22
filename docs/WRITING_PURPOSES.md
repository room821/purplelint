# Writing Effective Purposes

## Anatomy of a Purpose File

```yaml
id: billing                    # unique identifier
purpose: >                     # WHY this constraint exists
  All AI calls must go through our SDK for billing tracking.
violations:                    # WHAT counts as a violation
  - Direct API calls to LLM endpoints
  - Custom wrappers bypassing the SDK
good_examples:                 # HOW to do it right
  - title: "SDK call"
    code: |
      import { completion } from "@org/sdk";
bad_examples:                  # WHAT NOT to do
  - title: "Direct fetch"
    code: |
      fetch("https://api.openai.com/...");
context_hint: >                # WHERE to focus analysis
  Check import chains for SDK usage.
exceptions:                    # WHEN to skip
  - "Test files (*.test.ts)"
```

## Guidelines

### 1. Purpose Must Explain WHY

Bad: "Don't call APIs directly"
Good: "All AI calls must go through our SDK. Direct calls bypass billing and cause revenue leakage."

The purpose is the anchor. When an AI model encounters an edge case,
it returns to this text to make its judgment.

### 2. Violations Must Be Specific

Bad: "Bad code patterns"
Good: "Direct fetch/axios calls to LLM provider endpoints (OpenAI, Anthropic, Google AI)"

Vague violations lead to false positives.

### 3. Examples Must Be Realistic

Use actual code patterns from your codebase, not abstract pseudocode.
Include the import statements — they're often the key signal.

### 4. Context Hints Guide Analysis

Tell the model WHERE to look:
- "Check import chains"
- "Focus on return types"
- "Look for DB read-write pairs without transaction wrappers"

### 5. Exceptions Prevent False Positives

Be explicit about what to skip:
- Test files
- Mock/fixture files
- The implementation of the SDK itself

## Common Patterns

### API Boundary Guard
Ensure all external API calls go through a designated client.

### Layer Purity
Prevent concerns from leaking between architectural layers.

### Concurrency Safety
Require transactions for read-modify-write patterns.

### Auth Centralization
Keep auth logic in middleware, not scattered across handlers.

### Code Simplicity
Prevent over-engineering (single-implementation abstractions, etc.).

### Test Quality
Ensure tests have meaningful assertions, not just `toBeDefined()`.
