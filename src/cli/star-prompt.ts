/**
 * One-time GitHub star prompt shown after purplelint init.
 * Skipped when no TTY or when gh CLI is not installed.
 * State stored at ~/.purplelint/star-prompted.json — shows once per user.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";

const REPO = "room821/purplelint";

function stateDir(): string {
	return join(homedir(), ".purplelint");
}

function statePath(): string {
	return join(stateDir(), "star-prompted.json");
}

function hasBeenPrompted(): boolean {
	if (!existsSync(statePath())) return false;
	try {
		const data = JSON.parse(readFileSync(statePath(), "utf-8"));
		return typeof data.prompted_at === "string";
	} catch {
		return false;
	}
}

function markPrompted(): void {
	const dir = stateDir();
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	writeFileSync(statePath(), JSON.stringify({ prompted_at: new Date().toISOString() }, null, 2));
}

function isGhInstalled(): boolean {
	const result = spawnSync("gh", ["--version"], {
		encoding: "utf-8",
		stdio: ["ignore", "ignore", "ignore"],
		timeout: 3000,
	});
	return !result.error && result.status === 0;
}

async function askYesNo(question: string): Promise<boolean> {
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	try {
		const answer = (await rl.question(question)).trim().toLowerCase();
		return answer === "" || answer === "y" || answer === "yes";
	} finally {
		rl.close();
	}
}

export async function maybePromptGithubStar(): Promise<void> {
	if (!process.stdin.isTTY || !process.stdout.isTTY) return;
	if (hasBeenPrompted()) return;
	if (!isGhInstalled()) return;

	// Mark before asking — never prompt twice even if interrupted
	markPrompted();

	const approved = await askYesNo("\n  Enjoying purplelint? Star it on GitHub? [Y/n] ");
	if (!approved) return;

	const result = spawnSync("gh", ["api", "-X", "PUT", `/user/starred/${REPO}`], {
		encoding: "utf-8",
		stdio: ["ignore", "pipe", "pipe"],
		timeout: 10000,
	});

	if (!result.error && result.status === 0) {
		console.log("  Thanks for the star!");
	} else {
		const err = result.stderr?.trim() || result.error?.message || "unknown error";
		console.log(`  Could not star automatically: ${err}`);
		console.log(`  You can star manually: https://github.com/${REPO}`);
	}
}
