export type ContextStrategy = "diff" | "diff+imports" | "diff+imports+types";
export type OutputFormat = "json" | "markdown" | "sarif";
export type Confidence = "high" | "medium" | "low";
export type Severity = "error" | "warning" | "info";

export interface AilintGlobalConfig {
	context_strategy?: ContextStrategy;
	output_format?: OutputFormat;
	inherit?: boolean;
	min_confidence?: Confidence;
	ignore?: string[];
}

export interface AilintPurposeEntry {
	id: string;
	file: string;
	severity?: Severity;
	scope: string;
	ignore?: string[];
}

export interface AilintConfig {
	version: string;
	config?: AilintGlobalConfig;
	purposes: AilintPurposeEntry[];
}
