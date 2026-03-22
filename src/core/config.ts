import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import type { PurplelintConfig, PurplelintPurposeEntry } from "../types/config.js";

export interface ValidationError {
	field: string;
	message: string;
}

const VALID_CONTEXT_STRATEGIES = ["diff", "diff+imports", "diff+imports+types"];
const VALID_OUTPUT_FORMATS = ["json", "markdown", "sarif"];
const VALID_SEVERITIES = ["error", "warning", "info"];
const VALID_CONFIDENCES = ["high", "medium", "low"];

export function parseConfig(filePath: string): PurplelintConfig {
	const content = readFileSync(filePath, "utf-8");
	return parseConfigFromString(content);
}

export function parseConfigFromString(content: string): PurplelintConfig {
	const parsed = parseYaml(content);
	if (!parsed || typeof parsed !== "object") {
		throw new Error("Invalid YAML: expected an object");
	}
	return parsed as PurplelintConfig;
}

export function validateConfig(config: PurplelintConfig): ValidationError[] {
	const errors: ValidationError[] = [];

	if (!config.version) {
		errors.push({ field: "version", message: "missing required field: version" });
	}

	if (!config.purposes) {
		errors.push({ field: "purposes", message: "missing required field: purposes" });
		return errors;
	}

	if (!Array.isArray(config.purposes)) {
		errors.push({ field: "purposes", message: "purposes must be an array" });
		return errors;
	}

	if (config.purposes.length === 0) {
		errors.push({ field: "purposes", message: "purposes array must not be empty" });
	}

	for (let i = 0; i < config.purposes.length; i++) {
		const entry = config.purposes[i];
		const prefix = `purposes[${i}]`;
		errors.push(...validatePurposeEntry(entry, prefix));
	}

	if (config.config) {
		const gc = config.config;
		if (gc.context_strategy && !VALID_CONTEXT_STRATEGIES.includes(gc.context_strategy)) {
			errors.push({
				field: "config.context_strategy",
				message: `invalid value: "${gc.context_strategy}". Must be one of: ${VALID_CONTEXT_STRATEGIES.join(", ")}`,
			});
		}
		if (gc.output_format && !VALID_OUTPUT_FORMATS.includes(gc.output_format)) {
			errors.push({
				field: "config.output_format",
				message: `invalid value: "${gc.output_format}". Must be one of: ${VALID_OUTPUT_FORMATS.join(", ")}`,
			});
		}
		if (gc.min_confidence && !VALID_CONFIDENCES.includes(gc.min_confidence)) {
			errors.push({
				field: "config.min_confidence",
				message: `invalid value: "${gc.min_confidence}". Must be one of: ${VALID_CONFIDENCES.join(", ")}`,
			});
		}
	}

	return errors;
}

function validatePurposeEntry(entry: PurplelintPurposeEntry, prefix: string): ValidationError[] {
	const errors: ValidationError[] = [];

	if (!entry.id) {
		errors.push({ field: `${prefix}.id`, message: "missing required field: id" });
	}
	if (!entry.file) {
		errors.push({ field: `${prefix}.file`, message: "missing required field: file" });
	}
	if (!entry.scope) {
		errors.push({ field: `${prefix}.scope`, message: "missing required field: scope" });
	}
	if (entry.severity && !VALID_SEVERITIES.includes(entry.severity)) {
		errors.push({
			field: `${prefix}.severity`,
			message: `invalid value: "${entry.severity}". Must be one of: ${VALID_SEVERITIES.join(", ")}`,
		});
	}

	return errors;
}
