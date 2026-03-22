import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseConfig, validateConfig } from "../../core/config.js";
import { parsePurpose, validatePurpose } from "../../core/purpose.js";
import * as ui from "../ui.js";

export interface ValidateOptions {
	dir?: string;
}

export async function runValidate(options: ValidateOptions) {
	const ailintDir = resolve(options.dir || findAilintDir());

	if (!existsSync(ailintDir)) {
		ui.error(`ailint directory not found: ${ailintDir}`);
		ui.log('Run "npx ailint init" to create one.');
		process.exit(1);
	}

	const indexPath = join(ailintDir, "ailint.yml");
	if (!existsSync(indexPath)) {
		ui.error(`ailint.yml not found in ${ailintDir}`);
		process.exit(1);
	}

	ui.intro();
	ui.log(`Validating ${ailintDir}...`);

	let valid = 0;
	let warnings = 0;
	let errors = 0;

	// Validate ailint.yml
	try {
		const config = parseConfig(indexPath);
		const configErrors = validateConfig(config);

		if (configErrors.length === 0) {
			ui.success("ailint.yml — valid");
			valid++;
		} else {
			const hasErrors = configErrors.some((e) => !e.message.startsWith("missing optional"));
			if (hasErrors) {
				ui.error(`ailint.yml — invalid`);
				for (const err of configErrors) {
					ui.log(`  └─ ${err.message}`);
				}
				errors++;
			} else {
				ui.warn("ailint.yml — warning");
				for (const err of configErrors) {
					ui.log(`  └─ ${err.message}`);
				}
				warnings++;
			}
		}

		// Validate each purpose file
		for (const entry of config.purposes) {
			const purposePath = join(ailintDir, entry.file);

			if (!existsSync(purposePath)) {
				ui.error(`${entry.file} — file not found`);
				errors++;
				continue;
			}

			try {
				const purpose = parsePurpose(purposePath);
				const purposeErrors = validatePurpose(purpose);

				const errs = purposeErrors.filter((e) => e.level === "error");
				const warns = purposeErrors.filter((e) => e.level === "warning");

				if (errs.length === 0 && warns.length === 0) {
					ui.success(`${entry.file} — valid`);
					valid++;
				} else if (errs.length === 0) {
					ui.warn(`${entry.file} — warning`);
					for (const w of warns) {
						ui.log(`  └─ ${w.message}`);
					}
					warnings++;
				} else {
					ui.error(`${entry.file} — invalid`);
					for (const e of errs) {
						ui.log(`  └─ ${e.message}`);
					}
					errors++;
				}
			} catch (e) {
				ui.error(`${entry.file} — parse error`);
				ui.log(`  └─ ${e instanceof Error ? e.message : String(e)}`);
				errors++;
			}
		}
	} catch (e) {
		ui.error(`Failed to parse ailint.yml: ${e instanceof Error ? e.message : String(e)}`);
		process.exit(1);
	}

	ui.log("");
	ui.log(`Result: ${valid} valid, ${warnings} warning(s), ${errors} error(s)`);
	ui.outro(errors > 0 ? "Validation failed" : "Validation passed");

	if (errors > 0) process.exit(1);
}

function findAilintDir(): string {
	const candidates = [
		join(process.cwd(), "ailint"),
		join(process.cwd(), ".ailint"),
	];

	for (const dir of candidates) {
		if (existsSync(dir)) return dir;
	}

	return join(process.cwd(), "ailint");
}
