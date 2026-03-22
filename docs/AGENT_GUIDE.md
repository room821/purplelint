# Agent Guide: How to Execute ailint

This document is for AI coding agents (Claude Code, Codex, Cursor, etc.)
to understand how to read and execute ailint purpose files.

## When to Run ailint

Run ailint when:
- The developer asks you to check architecture
- Before a build, if the project has an `/ailint` directory
- When reviewing a PR that touches files matching purpose scopes

## Execution Steps

1. **Find ailint folder**: Look for `/ailint` directory from the changed file's
   location upward (cascading lookup)

2. **Read ailint.yml**: Parse the index file to get the list of purposes

3. **For each relevant purpose**:
   a. Read the purpose yml file
   b. Check if changed files match the `scope` glob
   c. Collect context (diff + imports based on `context_strategy`)
   d. Evaluate the change against the purpose
   e. Report results

4. **Evaluation rules**:
   - **When in doubt, pass.** Only flag clear, confident violations.
   - Judge based on `purpose` (why the constraint exists), not just pattern matching
   - Use `good_examples` and `bad_examples` as calibration
   - Apply `context_hint` for analysis focus
   - Respect `exceptions`

5. **Report format**:
   ```json
   {
     "violation": boolean,
     "confidence": "high" | "medium" | "low",
     "reason": "One sentence explanation",
     "location": "file:line",
     "suggestion": "One sentence fix suggestion"
   }
   ```

## Important: Purpose > Pattern

Do NOT just pattern match. Understand the PURPOSE.

Example: A purpose says "All AI calls must go through SDK."
- `fetch("https://api.openai.com/...")` — clear violation
- `import { customAI } from "./utils/ai"` — need to trace if it eventually
  calls the SDK or bypasses it. Check the import chain.
- `import { completion } from "@our-org/ai-client"` — passes, this IS the SDK

The purpose tells you WHY. Use it to judge edge cases.
