import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import type { Purpose } from "../types/purpose.js";

export interface PurposeValidationError {
	field: string;
	message: string;
	level: "error" | "warning";
}

export function parsePurpose(filePath: string): Purpose {
	const content = readFileSync(filePath, "utf-8");
	return parsePurposeFromString(content);
}

export function parsePurposeFromString(content: string): Purpose {
	const parsed = parseYaml(content);
	if (!parsed || typeof parsed !== "object") {
		throw new Error("Invalid YAML: expected an object");
	}
	return parsed as Purpose;
}

export function validatePurpose(purpose: Purpose): PurposeValidationError[] {
	const errors: PurposeValidationError[] = [];

	if (!purpose.id) {
		errors.push({ field: "id", message: "missing required field: id", level: "error" });
	}

	if (!purpose.purpose) {
		errors.push({
			field: "purpose",
			message: "missing required field: purpose",
			level: "error",
		});
	}

	if (!purpose.violations) {
		errors.push({
			field: "violations",
			message: "missing required field: violations",
			level: "error",
		});
	} else if (!Array.isArray(purpose.violations) || purpose.violations.length === 0) {
		errors.push({
			field: "violations",
			message: "violations must be a non-empty array",
			level: "error",
		});
	}

	if (!purpose.good_examples) {
		errors.push({
			field: "good_examples",
			message: "missing required field: good_examples",
			level: "error",
		});
	} else if (!Array.isArray(purpose.good_examples) || purpose.good_examples.length === 0) {
		errors.push({
			field: "good_examples",
			message: "good_examples must have at least 1 entry",
			level: "error",
		});
	} else {
		for (let i = 0; i < purpose.good_examples.length; i++) {
			const ex = purpose.good_examples[i];
			if (!ex.title) {
				errors.push({
					field: `good_examples[${i}].title`,
					message: "missing required field: title",
					level: "error",
				});
			}
			if (!ex.code) {
				errors.push({
					field: `good_examples[${i}].code`,
					message: "missing required field: code",
					level: "error",
				});
			}
		}
	}

	if (!purpose.bad_examples) {
		errors.push({
			field: "bad_examples",
			message: "missing required field: bad_examples",
			level: "error",
		});
	} else if (!Array.isArray(purpose.bad_examples) || purpose.bad_examples.length === 0) {
		errors.push({
			field: "bad_examples",
			message: "bad_examples must have at least 1 entry",
			level: "error",
		});
	} else {
		for (let i = 0; i < purpose.bad_examples.length; i++) {
			const ex = purpose.bad_examples[i];
			if (!ex.title) {
				errors.push({
					field: `bad_examples[${i}].title`,
					message: "missing required field: title",
					level: "error",
				});
			}
			if (!ex.code) {
				errors.push({
					field: `bad_examples[${i}].code`,
					message: "missing required field: code",
					level: "error",
				});
			}
		}
	}

	if (!purpose.context_hint) {
		errors.push({
			field: "context_hint",
			message: "missing optional field: context_hint",
			level: "warning",
		});
	}

	return errors;
}
