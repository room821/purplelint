export interface PurposeExample {
	title: string;
	code: string;
}

export interface Purpose {
	id: string;
	purpose: string;
	violations: string[];
	good_examples: PurposeExample[];
	bad_examples: PurposeExample[];
	context_hint?: string;
	exceptions?: string[];
}
