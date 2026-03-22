import * as p from "@clack/prompts";

export function intro() {
	p.intro("purplelint — Architecture Checkpoint");
}

export function outro(message: string) {
	p.outro(message);
}

export async function selectPurposes(
	purposes: { id: string; purpose: string }[],
): Promise<string[]> {
	const result = await p.multiselect({
		message: "Select purposes to check:",
		options: purposes.map((pur) => ({
			value: pur.id,
			label: `${pur.id} — ${pur.purpose.split("\n")[0].trim()}`,
		})),
		required: true,
	});

	if (p.isCancel(result)) {
		p.cancel("Cancelled.");
		process.exit(0);
	}

	return result as string[];
}

export async function selectPresets(
	presets: { id: string; label: string }[],
): Promise<string[]> {
	const result = await p.multiselect({
		message: "Which presets would you like to add?",
		options: [
			...presets.map((pr) => ({ value: pr.id, label: pr.label })),
			{ value: "none", label: "None (empty config only)" },
		],
		required: true,
	});

	if (p.isCancel(result)) {
		p.cancel("Cancelled.");
		process.exit(0);
	}

	const selected = result as string[];
	if (selected.includes("none")) return [];
	return selected;
}

export async function textInput(message: string, defaultValue: string): Promise<string> {
	const result = await p.text({
		message,
		defaultValue,
		placeholder: defaultValue,
	});

	if (p.isCancel(result)) {
		p.cancel("Cancelled.");
		process.exit(0);
	}

	return result as string;
}

export function log(message: string) {
	p.log.info(message);
}

export function success(message: string) {
	p.log.success(message);
}

export function warn(message: string) {
	p.log.warn(message);
}

export function error(message: string) {
	p.log.error(message);
}

export const spinner = p.spinner;
