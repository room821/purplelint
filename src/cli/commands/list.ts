import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseConfig } from "../../core/config.js";
import { parsePurpose } from "../../core/purpose.js";
import * as ui from "../ui.js";

export interface ListOptions {
	dir?: string;
}

export async function runList(options: ListOptions) {
	const ailintDir = resolve(options.dir || findAilintDir());

	if (!existsSync(ailintDir)) {
		ui.error(`purplelint directory not found: ${ailintDir}`);
		ui.log('Run "npx purplelint init" to create one.');
		process.exit(1);
	}

	const indexPath = join(ailintDir, "purplelint.yml");
	if (!existsSync(indexPath)) {
		ui.error(`purplelint.yml not found in ${ailintDir}`);
		process.exit(1);
	}

	const config = parseConfig(indexPath);
	const count = config.purposes.length;

	console.log("");
	console.log(`  purplelint purposes (${count} found)`);
	console.log("");

	for (const entry of config.purposes) {
		const purposePath = join(ailintDir, entry.file);
		let purposeText = "";

		if (existsSync(purposePath)) {
			try {
				const purpose = parsePurpose(purposePath);
				purposeText = purpose.purpose.split("\n")[0].trim();
			} catch {
				purposeText = "(parse error)";
			}
		} else {
			purposeText = "(file not found)";
		}

		const severity = entry.severity || "warning";
		const id = entry.id.padEnd(18);
		console.log(`  ${id}[${severity}]  ${entry.scope}`);
		console.log(`  → ${purposeText}`);
		console.log("");
	}
}

function findAilintDir(): string {
	const candidates = [join(process.cwd(), "purplelint"), join(process.cwd(), ".purplelint")];

	for (const dir of candidates) {
		if (existsSync(dir)) return dir;
	}

	return join(process.cwd(), "purplelint");
}
