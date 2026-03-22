import type { Severity } from "../types/config.js";
import type { PurplelintRunResult, PurposeResult } from "../types/result.js";

/**
 * Creates a new empty run result.
 */
export function createRunResult(): PurplelintRunResult {
	return {
		version: "0.1",
		timestamp: new Date().toISOString(),
		results: [],
	};
}

/**
 * Formats the run result as JSON string.
 */
export function formatResultJson(result: PurplelintRunResult): string {
	return JSON.stringify(result, null, 2);
}

/**
 * Formats the run result as markdown.
 */
export function formatResultMarkdown(result: PurplelintRunResult): string {
	const lines: string[] = [];
	lines.push("# purplelint Results");
	lines.push("");
	lines.push(`**Time:** ${result.timestamp}`);
	lines.push("");

	const violations = result.results.filter((r) => r.violation);
	const passes = result.results.filter((r) => !r.violation);

	if (violations.length > 0) {
		lines.push("## Violations");
		lines.push("");
		for (const v of violations) {
			const icon = severityIcon(v.severity);
			lines.push(`${icon} **${v.purpose_id}** [${v.severity}] (${v.confidence})`);
			if (v.location) lines.push(`  Location: \`${v.location}\``);
			if (v.reason) lines.push(`  Reason: ${v.reason}`);
			if (v.suggestion) lines.push(`  Suggestion: ${v.suggestion}`);
			lines.push("");
		}
	}

	if (passes.length > 0) {
		lines.push("## Passed");
		lines.push("");
		for (const p of passes) {
			lines.push(`✅ **${p.purpose_id}** — passed`);
		}
		lines.push("");
	}

	lines.push(
		`**Summary:** ${violations.length} violation(s), ${passes.length} passed`,
	);

	return lines.join("\n");
}

function severityIcon(severity: Severity): string {
	switch (severity) {
		case "error":
			return "❌";
		case "warning":
			return "⚠️";
		case "info":
			return "ℹ️";
	}
}

/**
 * Checks if any results have error-level violations.
 */
export function hasErrorViolations(result: PurplelintRunResult): boolean {
	return result.results.some((r) => r.violation && r.severity === "error");
}
