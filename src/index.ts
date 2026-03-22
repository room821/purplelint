export type {
	AilintConfig,
	AilintGlobalConfig,
	AilintPurposeEntry,
	AilintRunResult,
	Confidence,
	ContextStrategy,
	OutputFormat,
	Purpose,
	PurposeExample,
	PurposeResult,
	Severity,
} from "./types/index.js";

export { parseConfig, validateConfig } from "./core/config.js";
export { parsePurpose, validatePurpose } from "./core/purpose.js";
export { lookupAilintConfigs, mergeConfigs } from "./core/lookup.js";
export { matchScope } from "./core/scope.js";
export { collectContext } from "./core/context.js";
export { buildPrompt } from "./core/prompt-builder.js";
export { scanProject } from "./core/scanner.js";
export type { ScanResult, ScannedPurpose } from "./core/scanner.js";
