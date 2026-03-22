import type { Confidence, Severity } from "./config.js";

export interface PurposeResult {
	purpose_id: string;
	violation: boolean;
	confidence: Confidence;
	severity: Severity;
	reason: string | null;
	location: string | null;
	suggestion: string | null;
}

export interface AilintRunResult {
	version: string;
	timestamp: string;
	results: PurposeResult[];
}
