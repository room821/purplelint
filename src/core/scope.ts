import fg from "fast-glob";

/**
 * Filters files that match the given glob scope pattern.
 */
export function matchScope(files: string[], scope: string, cwd?: string): string[] {
	return fg
		.sync(scope, {
			cwd: cwd || process.cwd(),
			onlyFiles: true,
			dot: false,
		})
		.filter((f) => files.includes(f));
}

/**
 * Returns files matching scope from a list of changed files.
 */
export function filterByScope(changedFiles: string[], scope: string, ignore?: string[]): string[] {
	const patterns = splitScope(scope);

	return changedFiles.filter((file) => {
		// Check ignore patterns first
		if (ignore?.length) {
			const excluded = ignore.some((ig) => matchesGlob(file, ig));
			if (excluded) return false;
		}

		return patterns.some((pattern) => {
			if (!fg.isDynamicPattern(pattern)) {
				return file === pattern || file.startsWith(pattern);
			}
			return matchesGlob(file, pattern);
		});
	});
}

function matchesGlob(file: string, pattern: string): boolean {
	// Convert glob pattern to regex
	// Process the pattern character by character for correct handling
	let regexStr = "";
	let i = 0;

	while (i < pattern.length) {
		const char = pattern[i];

		if (char === "*" && pattern[i + 1] === "*") {
			// ** — match any number of directories (including zero)
			if (pattern[i + 2] === "/") {
				// **/ — match any directory prefix (including empty)
				regexStr += "(?:.*/)?";
				i += 3;
			} else {
				// ** at end — match everything
				regexStr += ".*";
				i += 2;
			}
		} else if (char === "*") {
			// * — match anything except /
			regexStr += "[^/]*";
			i++;
		} else if (char === "?") {
			regexStr += "[^/]";
			i++;
		} else if (char === "{") {
			// {a,b,c} — brace expansion to (a|b|c)
			const closeIdx = pattern.indexOf("}", i);
			if (closeIdx !== -1) {
				const options = pattern.slice(i + 1, closeIdx).split(",").map((o) => o.replace(/\./g, "\\.")).join("|");
				regexStr += `(${options})`;
				i = closeIdx + 1;
			} else {
				regexStr += "\\{";
				i++;
			}
		} else if (char === ".") {
			regexStr += "\\.";
			i++;
		} else {
			regexStr += char;
			i++;
		}
	}

	const regex = new RegExp(`^${regexStr}$`);
	return regex.test(file);
}

/** Split scope by comma, but respect braces so {ts,tsx} stays together */
function splitScope(scope: string): string[] {
	const parts: string[] = [];
	let current = "";
	let braceDepth = 0;

	for (const ch of scope) {
		if (ch === "{") braceDepth++;
		else if (ch === "}") braceDepth--;

		if (ch === "," && braceDepth === 0) {
			parts.push(current.trim());
			current = "";
		} else {
			current += ch;
		}
	}

	if (current.trim()) parts.push(current.trim());
	return parts;
}
