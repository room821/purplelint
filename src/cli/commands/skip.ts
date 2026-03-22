import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import * as ui from "../ui.js";

const SKIP_FILE = ".purplelint-skip.json";

export interface SkipOptions {
	purposeId?: string;
	days?: string;
	dir?: string;
	clear?: boolean;
}

export type SkipMap = Record<string, string>;

export function getSkipFilePath(dir: string): string {
	return join(dir, SKIP_FILE);
}

export function loadSkips(dir: string): SkipMap {
	const skipPath = getSkipFilePath(dir);
	if (!existsSync(skipPath)) return {};
	try {
		return JSON.parse(readFileSync(skipPath, "utf-8"));
	} catch {
		return {};
	}
}

export function saveSkips(dir: string, skips: SkipMap): void {
	const skipPath = getSkipFilePath(dir);
	if (Object.keys(skips).length === 0) {
		if (existsSync(skipPath)) unlinkSync(skipPath);
		return;
	}
	writeFileSync(skipPath, `${JSON.stringify(skips, null, 2)}\n`);
}

export function isSkipped(skips: SkipMap, purposeId: string): boolean {
	const expiresAt = skips[purposeId];
	if (!expiresAt) return false;
	return new Date(expiresAt) > new Date();
}

export function cleanExpired(skips: SkipMap): SkipMap {
	const now = new Date();
	const cleaned: SkipMap = {};
	for (const [id, expiresAt] of Object.entries(skips)) {
		if (new Date(expiresAt) > now) {
			cleaned[id] = expiresAt;
		}
	}
	return cleaned;
}

function findPurplelintDir(dir?: string): string {
	if (dir) return resolve(dir);
	const candidates = [join(process.cwd(), "purplelint"), join(process.cwd(), ".purplelint")];
	for (const d of candidates) {
		if (existsSync(d)) return d;
	}
	return join(process.cwd(), "purplelint");
}

export async function runSkip(options: SkipOptions) {
	ui.intro();
	const purplelintDir = findPurplelintDir(options.dir);

	if (options.clear) {
		const skipPath = getSkipFilePath(purplelintDir);
		if (existsSync(skipPath)) {
			unlinkSync(skipPath);
			ui.success("All skips cleared");
		} else {
			ui.log("No skips to clear");
		}
		ui.outro("Done");
		return;
	}

	if (!options.purposeId) {
		// Show current skips
		const skips = cleanExpired(loadSkips(purplelintDir));
		saveSkips(purplelintDir, skips);

		if (Object.keys(skips).length === 0) {
			ui.log("No active skips");
			ui.log("");
			ui.log("Usage: purplelint skip <purpose-id> <days>");
			ui.log("  e.g. purplelint skip billing-tracking 7");
		} else {
			ui.log("Active skips:");
			for (const [id, expiresAt] of Object.entries(skips)) {
				const expires = new Date(expiresAt);
				const daysLeft = Math.ceil((expires.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
				ui.log(`  ${id} — ${daysLeft} day(s) remaining (expires ${expires.toLocaleDateString()})`);
			}
		}
		ui.outro("Done");
		return;
	}

	const days = Number.parseInt(options.days || "7", 10);
	if (Number.isNaN(days) || days < 1 || days > 365) {
		ui.error("Days must be between 1 and 365");
		process.exit(1);
	}

	const skips = cleanExpired(loadSkips(purplelintDir));
	const expiresAt = new Date();
	expiresAt.setDate(expiresAt.getDate() + days);
	skips[options.purposeId] = expiresAt.toISOString();

	saveSkips(purplelintDir, skips);
	ui.success(
		`Skipping "${options.purposeId}" for ${days} day(s) (until ${expiresAt.toLocaleDateString()})`,
	);
	ui.outro("Done");
}
