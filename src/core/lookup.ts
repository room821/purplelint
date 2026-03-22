import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseConfig, validateConfig } from "./config.js";
import type { PurplelintConfig } from "../types/config.js";

/**
 * Finds purplelint/ directories by walking up from the given file path to rootDir.
 * Returns configs from closest to farthest (cascading lookup like .gitignore).
 */
export function lookupAilintConfigs(filePath: string, rootDir: string): PurplelintConfig[] {
	const configs: PurplelintConfig[] = [];
	const absRoot = resolve(rootDir);
	let current = resolve(dirname(filePath));

	while (true) {
		const ailintDir = join(current, "purplelint");
		const ailintYml = join(ailintDir, "purplelint.yml");

		if (existsSync(ailintYml)) {
			try {
				const config = parseConfig(ailintYml);
				const errors = validateConfig(config);
				const hasErrors = errors.some(
					(e) => !e.message.startsWith("missing optional"),
				);
				if (!hasErrors) {
					configs.push(config);
				}
			} catch {
				// Skip invalid configs
			}
		}

		if (current === absRoot) break;

		const parent = dirname(current);
		if (parent === current) break; // filesystem root
		current = parent;
	}

	return configs;
}

/**
 * Merges multiple configs (closest-first order).
 * Closer configs override farther ones. Stops at inherit: false.
 */
export function mergeConfigs(configs: PurplelintConfig[]): PurplelintConfig {
	if (configs.length === 0) {
		return { version: "0.1", purposes: [] };
	}

	if (configs.length === 1) {
		return configs[0];
	}

	const merged: PurplelintConfig = {
		version: configs[0].version,
		config: { ...configs[configs.length - 1].config },
		purposes: [],
	};

	// Determine how far back to look — stop at the first inherit: false
	// configs[0] is closest, configs[n-1] is farthest
	let stopIndex = configs.length - 1;
	for (let i = 0; i < configs.length; i++) {
		if (configs[i].config?.inherit === false) {
			stopIndex = i;
			break;
		}
	}

	// Process from farthest (stopIndex) to closest (0) so closer overrides
	const purposeMap = new Map<string, (typeof merged.purposes)[0]>();

	for (let i = stopIndex; i >= 0; i--) {
		const config = configs[i];

		// Merge global config (closer overrides)
		if (config.config) {
			merged.config = { ...merged.config, ...config.config };
		}

		// Merge purposes by id (closer overrides)
		for (const purpose of config.purposes) {
			purposeMap.set(purpose.id, purpose);
		}
	}

	merged.purposes = Array.from(purposeMap.values());
	return merged;
}
