import type { Purpose } from "../types/purpose.js";
import type { CodeContext } from "./context.js";

/**
 * Builds a prompt for a model to evaluate code against a purpose.
 */
export function buildPrompt(purpose: Purpose, context: CodeContext): string {
	const sections: string[] = [];

	sections.push(`You are a code architecture linter.
Evaluate whether the code changes violate the given purpose.
When in doubt, judge as pass. Only flag clear violations.`);

	sections.push(`[Purpose]
${purpose.purpose.trim()}`);

	sections.push(`[Violation Criteria]\n${purpose.violations.map((v) => `- ${v}`).join("\n")}`);

	if (purpose.good_examples.length > 0) {
		const examples = purpose.good_examples
			.map((ex) => `### ${ex.title}\n\`\`\`\n${ex.code.trim()}\n\`\`\``)
			.join("\n\n");
		sections.push(`[Good Examples]\n${examples}`);
	}

	if (purpose.bad_examples.length > 0) {
		const examples = purpose.bad_examples
			.map((ex) => `### ${ex.title}\n\`\`\`\n${ex.code.trim()}\n\`\`\``)
			.join("\n\n");
		sections.push(`[Bad Examples]\n${examples}`);
	}

	if (purpose.context_hint) {
		sections.push(`[Analysis Hints]\n${purpose.context_hint.trim()}`);
	}

	if (purpose.exceptions && purpose.exceptions.length > 0) {
		sections.push(`[Exceptions]\n${purpose.exceptions.map((e) => `- ${e}`).join("\n")}`);
	}

	// Build code context section
	const codeSection = buildCodeSection(context);
	sections.push(`[Changed Code]\n${codeSection}`);

	sections.push(`Respond ONLY in the following JSON format:
{
  "violation": boolean,
  "confidence": "high" | "medium" | "low",
  "reason": "Violation reason (one sentence)",
  "location": "file:line",
  "suggestion": "Fix suggestion (one sentence)"
}`);

	return sections.join("\n\n");
}

function buildCodeSection(context: CodeContext): string {
	const parts: string[] = [];

	if (context.diff) {
		parts.push(context.diff);
	}

	if (context.imports && context.imports.length > 0) {
		const importLines = context.imports
			.map((imp) => `${imp.source}: ${imp.specifiers.join(", ")}`)
			.join("\n");
		parts.push(`\n--- Import Chain ---\n${importLines}`);
	}

	if (context.typeDefinitions && context.typeDefinitions.length > 0) {
		parts.push(`\n--- Type Definitions ---\n${context.typeDefinitions.join("\n")}`);
	}

	return parts.join("\n");
}
