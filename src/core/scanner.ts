import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import fg from "fast-glob";

export interface ScanResult {
	category: string;
	label: string;
	evidence: ScanEvidence[];
	purposeData: ScannedPurpose;
}

export interface ScanEvidence {
	file: string;
	line?: number;
	snippet: string;
}

export interface ScannedPurpose {
	id: string;
	purpose: string;
	violations: string[];
	good_example: { title: string; code: string };
	bad_example: { title: string; code: string };
	context_hint: string;
	scope: string;
	severity: "error" | "warning";
}

interface DetectorContext {
	cwd: string;
	files: string[];
	packageJson: Record<string, any> | null;
	pythonDeps: string[];
	primaryLang: "ts" | "py" | "go" | "java" | "rb" | "rs" | "mixed";
}

interface Detector {
	name: string;
	category: string;
	detect(ctx: DetectorContext): ScanResult | null;
}

/**
 * Scans a project to auto-discover architecture patterns
 * and generate tailored purpose files.
 */
export async function scanProject(cwd: string): Promise<ScanResult[]> {
	const files = fg.sync(["**/*.{ts,tsx,js,jsx,py,go,java,rb,rs}", "**/*.json"], {
		cwd,
		ignore: [
			"**/node_modules/**",
			"**/dist/**",
			"**/build/**",
			"**/.git/**",
			"**/vendor/**",
			"**/venv/**",
		],
		onlyFiles: true,
		dot: false,
	});

	// Merge all package.json deps (root + monorepo subdirectories)
	const allNodeDeps: Record<string, string> = {};
	const subDirs = ["api", "server", "backend", "worker", "web", "frontend", "client", "app"];

	// Also find packages/*/package.json and apps/*/package.json
	const pkgJsonPaths = [join(cwd, "package.json")];
	for (const sub of subDirs) {
		pkgJsonPaths.push(join(cwd, sub, "package.json"));
	}
	// Scan packages/* and apps/*
	for (const mono of ["packages", "apps"]) {
		const monoDir = join(cwd, mono);
		if (existsSync(monoDir)) {
			try {
				for (const entry of readdirSync(monoDir)) {
					pkgJsonPaths.push(join(monoDir, entry, "package.json"));
				}
			} catch {
				/* ignore */
			}
		}
	}

	let packageJson: Record<string, any> | null = null;
	for (const pkgPath of pkgJsonPaths) {
		if (existsSync(pkgPath)) {
			try {
				const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
				if (!packageJson) packageJson = pkg;
				Object.assign(allNodeDeps, pkg.dependencies || {}, pkg.devDependencies || {});
			} catch {
				/* ignore */
			}
		}
	}
	// Attach merged deps so hasDependency can find them
	if (packageJson) {
		packageJson = { ...packageJson, dependencies: allNodeDeps, devDependencies: {} };
	} else if (Object.keys(allNodeDeps).length > 0) {
		packageJson = { dependencies: allNodeDeps, devDependencies: {} };
	}

	// Parse Python dependencies (root + subdirectories for monorepos)
	const pythonDeps = parsePythonDeps(cwd);

	for (const sub of subDirs) {
		const subPath = join(cwd, sub);
		if (existsSync(subPath)) {
			pythonDeps.push(...parsePythonDeps(subPath));
		}
	}

	// Detect primary language
	const primaryLang = detectPrimaryLang(files);

	const ctx: DetectorContext = { cwd, files, packageJson, pythonDeps, primaryLang };
	const results: ScanResult[] = [];

	for (const detector of DETECTORS) {
		const result = detector.detect(ctx);
		if (result) results.push(result);
	}

	return results;
}

// --- Helpers ---

function searchFiles(
	ctx: DetectorContext,
	patterns: string[],
	fileGlobs?: string[],
): ScanEvidence[] {
	const evidence: ScanEvidence[] = [];
	const targetFiles = fileGlobs
		? ctx.files.filter((f) => fileGlobs.some((g) => f.match(globToRegex(g))))
		: ctx.files;

	for (const file of targetFiles.slice(0, 200)) {
		// limit scan size
		const fullPath = join(ctx.cwd, file);
		try {
			const content = readFileSync(fullPath, "utf-8");
			const lines = content.split("\n");
			for (let i = 0; i < lines.length; i++) {
				for (const pattern of patterns) {
					if (lines[i].toLowerCase().includes(pattern.toLowerCase())) {
						evidence.push({
							file,
							line: i + 1,
							snippet: lines[i].trim().slice(0, 120),
						});
					}
				}
			}
		} catch {
			/* skip unreadable */
		}

		if (evidence.length >= 10) break; // enough evidence
	}

	return evidence;
}

function hasDependency(ctx: DetectorContext, ...deps: string[]): string | null {
	// Check Node.js package.json
	if (ctx.packageJson) {
		const allDeps = {
			...ctx.packageJson.dependencies,
			...ctx.packageJson.devDependencies,
		};
		for (const dep of deps) {
			if (allDeps?.[dep]) return dep;
		}
	}

	// Check Python deps
	for (const dep of deps) {
		const normalized = dep.toLowerCase().replace(/-/g, "_").replace(/@.*/, "");
		if (ctx.pythonDeps.some((d) => d.toLowerCase().replace(/-/g, "_") === normalized)) {
			return dep;
		}
	}

	return null;
}

function parsePythonDeps(cwd: string): string[] {
	const deps: string[] = [];

	// requirements.txt
	const reqPath = join(cwd, "requirements.txt");
	if (existsSync(reqPath)) {
		try {
			const content = readFileSync(reqPath, "utf-8");
			for (const line of content.split("\n")) {
				const trimmed = line.trim();
				if (trimmed && !trimmed.startsWith("#") && !trimmed.startsWith("-")) {
					// Extract package name: "package==1.0" → "package"
					const name = trimmed.split(/[>=<!~\[]/)[0].trim();
					if (name) deps.push(name);
				}
			}
		} catch {
			/* ignore */
		}
	}

	// pyproject.toml (simplified parsing)
	const pyprojectPath = join(cwd, "pyproject.toml");
	if (existsSync(pyprojectPath)) {
		try {
			const content = readFileSync(pyprojectPath, "utf-8");
			// Look for dependencies = ["pkg1", "pkg2>=1.0"]
			const depMatch = content.match(/dependencies\s*=\s*\[([\s\S]*?)\]/);
			if (depMatch) {
				const depsStr = depMatch[1];
				const pkgMatches = depsStr.matchAll(/["']([^"'>=<!~\[]+)/g);
				for (const m of pkgMatches) {
					deps.push(m[1].trim());
				}
			}
		} catch {
			/* ignore */
		}
	}

	// setup.py (simplified)
	const setupPath = join(cwd, "setup.py");
	if (existsSync(setupPath)) {
		try {
			const content = readFileSync(setupPath, "utf-8");
			const installReqs = content.match(/install_requires\s*=\s*\[([\s\S]*?)\]/);
			if (installReqs) {
				const pkgMatches = installReqs[1].matchAll(/["']([^"'>=<!~\[]+)/g);
				for (const m of pkgMatches) {
					deps.push(m[1].trim());
				}
			}
		} catch {
			/* ignore */
		}
	}

	return deps;
}

function detectPrimaryLang(files: string[]): DetectorContext["primaryLang"] {
	const counts: Record<string, number> = {};
	for (const f of files) {
		if (f.endsWith(".ts") || f.endsWith(".tsx")) counts.ts = (counts.ts || 0) + 1;
		else if (f.endsWith(".py")) counts.py = (counts.py || 0) + 1;
		else if (f.endsWith(".go")) counts.go = (counts.go || 0) + 1;
		else if (f.endsWith(".java")) counts.java = (counts.java || 0) + 1;
		else if (f.endsWith(".rb")) counts.rb = (counts.rb || 0) + 1;
		else if (f.endsWith(".rs")) counts.rs = (counts.rs || 0) + 1;
	}

	const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
	if (sorted.length === 0) return "mixed";

	const top = sorted[0];
	const total = sorted.reduce((s, [, c]) => s + c, 0);

	// If top language is >50% of files, it's primary
	if (top[1] / total > 0.5) return top[0] as DetectorContext["primaryLang"];
	return "mixed";
}

function langGlob(ctx: DetectorContext): string {
	switch (ctx.primaryLang) {
		case "ts":
			return "**/*.{ts,tsx,js,jsx}";
		case "py":
			return "**/*.py";
		case "go":
			return "**/*.go";
		case "java":
			return "**/*.java";
		case "rb":
			return "**/*.rb";
		case "rs":
			return "**/*.rs";
		default:
			return "**/*.{ts,js,py,go,java,rb,rs}";
	}
}

function hasFiles(ctx: DetectorContext, patterns: string[]): string[] {
	const EXCLUDE = ["scripts/", "test", "spec", "fixture", "mock", "e2e/", "__tests__", "migration"];
	return ctx.files.filter((f) => {
		const lower = f.toLowerCase();
		if (EXCLUDE.some((ex) => lower.includes(ex))) return false;
		return patterns.some((p) => lower.includes(p.toLowerCase()));
	});
}

/** Rank gateway candidates: prefer packages/src dirs + service/client/sdk/lib/middleware names */
function pickGateway(files: string[], fallback: string): string {
	if (files.length === 0) return fallback;

	const GOOD_DIRS = ["packages/", "src/", "lib/", "app/"];
	const GOOD_NAMES = [
		"service",
		"client",
		"sdk",
		"lib",
		"middleware",
		"gateway",
		"wrapper",
		"provider",
	];

	// Score each file
	const scored = files.map((f) => {
		const lower = f.toLowerCase();
		let score = 0;
		if (GOOD_DIRS.some((d) => lower.includes(d))) score += 2;
		if (GOOD_NAMES.some((n) => lower.includes(n))) score += 1;
		// Prefer shorter paths (closer to the actual module, not deep internals)
		if (f.split("/").length <= 4) score += 1;
		return { file: f, score };
	});

	scored.sort((a, b) => b.score - a.score);
	return scored[0].file;
}

function globToRegex(glob: string): RegExp {
	const r = glob.replace(/\./g, "\\.").replace(/\*\*/g, ".*").replace(/\*/g, "[^/]*");
	return new RegExp(r);
}

// --- Detectors ---

const DETECTORS: Detector[] = [
	// 1. Payment / Billing SDK
	{
		name: "payment-sdk",
		category: "billing",
		detect(ctx) {
			const stripe = hasDependency(ctx, "stripe", "@stripe/stripe-node");
			const paddle = hasDependency(ctx, "@paddle/paddle-node-sdk", "paddle-sdk");
			const lemonsqueezy = hasDependency(ctx, "@lemonsqueezy/lemonsqueezy.js");
			const sdk = stripe || paddle || lemonsqueezy;

			if (!sdk) {
				// Also search for payment-related patterns in code
				const evidence = searchFiles(
					ctx,
					[
						"stripe.charges.create",
						"stripe.paymentIntents",
						"paddle.transactions",
						"billing",
						"charge(",
						"createPayment",
						"processPayment",
					],
					["**/*.{ts,js,py,go,java,rb}"],
				);

				if (evidence.length < 2) return null;

				return {
					category: "billing",
					label: "Payment processing detected (custom)",
					evidence: evidence.slice(0, 5),
					purposeData: {
						id: "billing-tracking",
						purpose:
							"All payment and billing operations must be traceable. Every charge, refund, and subscription change must include user identification and tracking metadata to prevent revenue leakage and enable audit trails.",
						violations: [
							"Payment operations without userId or requestId metadata",
							"Direct payment API calls bypassing the designated payment service",
							"Charges or refunds without audit logging",
						],
						good_example: {
							title: "Payment with tracking metadata",
							code: `await paymentService.charge({\n  amount,\n  userId: req.user.id,\n  metadata: { source: "upgrade", planId }\n});`,
						},
						bad_example: {
							title: "Untracked payment",
							code: `await stripe.charges.create({ amount, currency: "usd" });\n// No userId, no tracking, no audit trail`,
						},
						context_hint:
							"Look for payment/charge/billing function calls. Every one must include user identification and tracking metadata.",
						scope: langGlob(ctx),
						severity: "error",
					},
				};
			}

			const evidence = searchFiles(ctx, [sdk, "charge", "payment", "subscription", "invoice"]);

			// Find the wrapper/service file
			const paymentFiles = hasFiles(ctx, ["payment", "billing", "stripe", "checkout"]);
			const gatewayFile = pickGateway(paymentFiles, "your payment service");

			// Check for webhook handling patterns
			const webhookEvidence = searchFiles(ctx, [
				"webhooks.constructEvent",
				"webhook_construct_event",
				"verify_webhook",
				"verifyWebhookSignature",
				"webhookSecret",
				"idempotencyKey",
				"idempotency_key",
			]);

			const hasWebhook = webhookEvidence.length > 0;

			return {
				category: "billing",
				label: `${sdk} detected${hasWebhook ? " + webhooks" : ""}`,
				evidence: [...evidence, ...webhookEvidence].slice(0, 5),
				purposeData: {
					id: "billing-tracking",
					purpose:
						"Payment flows must follow a strict sequence. Charge: validate server-side → create idempotent intent → log audit → confirm. Webhook: verify signature → persist raw event → deduplicate → process → acknowledge. Any step out of order or missing causes revenue leakage, double charges, or lost events.",
					violations: [
						"SEQUENCE BREAK: Webhook processes event before persisting it (must be store → process, never process → store)",
						"SEQUENCE BREAK: Charge created before server-side price validation (client amount trusted)",
						"MISSING STEP: Webhook handler without signature verification as the FIRST operation",
						"MISSING STEP: Payment mutation without idempotency key — retries cause double charges",
						"MISSING STEP: No deduplication check before processing webhook (same event.id processed twice)",
						"MISSING STEP: Charge/refund without audit trail (userId, requestId, timestamp, amount)",
						`BOUNDARY: Direct ${sdk} API calls outside the designated payment service (${gatewayFile})`,
					],
					good_example: {
						title: "Correct sequence: webhook flow",
						code: "// Step 1: VERIFY — always first\nconst event = stripe.webhooks.constructEvent(body, sig, secret);\n// Step 2: PERSIST — store raw event before any processing\nawait db.webhookEvent.create({ eventId: event.id, raw: body });\n// Step 3: DEDUPLICATE — skip if already processed\nif (await isProcessed(event.id)) return res.json({ received: true });\n// Step 4: PROCESS — business logic\nawait paymentService.fulfill(event);\n// Step 5: ACKNOWLEDGE — mark as processed\nawait markProcessed(event.id);",
					},
					bad_example: {
						title: "Broken sequence: process before store",
						code: "const event = JSON.parse(req.body); // no signature verification!\nawait updateSubscription(event.data); // processes before storing\nawait db.webhookEvent.create({ data: event }); // if line above crashes, event lost\n// no deduplication — webhook retry = double subscription update",
					},
					context_hint:
						"Trace the SEQUENCE of operations in webhook handlers and payment flows. The order matters: 1→verify, 2→persist, 3→deduplicate, 4→process, 5→acknowledge. Flag any code where processing happens before persistence, or where signature verification is not the first operation.",
					scope: langGlob(ctx),
					severity: "error",
				},
			};
		},
	},

	// 2. Auth / JWT
	{
		name: "auth-system",
		category: "auth",
		detect(ctx) {
			const jwt = hasDependency(ctx, "jsonwebtoken", "jose", "@auth/core", "next-auth", "passport");
			const evidence = searchFiles(ctx, [
				"jwt.verify",
				"jwt.decode",
				"jwt.sign",
				"verifyToken",
				"authMiddleware",
				"requireAuth",
				"getSession",
				"req.headers.authorization",
			]);

			if (!jwt && evidence.length < 2) return null;

			// Find middleware file
			const middlewareFiles = hasFiles(ctx, ["middleware", "auth", "guard"]);
			const authFile = pickGateway(middlewareFiles, "middleware/auth");

			// Check for rate limiting
			const rateLimitEvidence = searchFiles(ctx, [
				"rateLimit",
				"rate_limit",
				"throttle",
				"express-rate-limit",
				"slowDown",
			]);

			return {
				category: "auth",
				label: jwt ? `${jwt} auth detected` : "Auth patterns detected",
				evidence: evidence.slice(0, 5),
				purposeData: {
					id: "auth-boundary",
					purpose: `Auth must follow a strict sequence per request: extract token → verify signature → validate expiry → attach user context → check permissions. This sequence runs ONCE in middleware (${authFile}), never in handlers or services. Auth endpoints must be rate-limited. Refresh tokens must be rotated on use.`,
					violations: [
						"SEQUENCE BREAK: Token used (decoded) before signature verification (jwt.decode instead of jwt.verify)",
						"SEQUENCE BREAK: Permission check before authentication — unauthed user hits authz logic",
						"MISSING STEP: Token expiry (exp) not validated — expired tokens accepted",
						"MISSING STEP: Refresh token reused without rotation — stolen token works forever",
						"MISSING STEP: Auth endpoints (login, register, reset-password) without rate limiting",
						"BOUNDARY: Token parsing/verification outside ${authFile} — scattered in handlers or services",
						"BOUNDARY: Direct access to req.headers.authorization in handlers or services",
						"LEAK: Error messages revealing whether email/username exists (user enumeration)",
						"LEAK: JWT secret hardcoded instead of from environment variable",
					],
					good_example: {
						title: "Correct sequence: middleware auth pipeline",
						code: `// ${authFile} — runs ONCE per request\n// Step 1: EXTRACT\nconst token = req.headers.authorization?.split(" ")[1];\n// Step 2: VERIFY signature\nconst decoded = jwt.verify(token, process.env.JWT_SECRET);\n// Step 3: VALIDATE expiry\nif (decoded.exp < Date.now() / 1000) throw new TokenExpiredError();\n// Step 4: ATTACH user context\nreq.user = { id: decoded.sub, role: decoded.role };\n// Step 5: Handler uses req.user — no auth logic here\napp.get("/api/data", authMiddleware, (req, res) => service.get(req.user.id));`,
					},
					bad_example: {
						title: "Broken sequence: decode without verify, auth in handler",
						code: `app.get("/api/data", (req, res) => {\n  const token = req.headers.authorization?.split(" ")[1];\n  const user = jwt.decode(token); // decode only — accepts UNSIGNED tokens!\n  // No expiry check, no rate limit, auth scattered into handler\n  if (user.role !== "admin") return res.status(403);\n});`,
					},
					context_hint: `Trace the auth SEQUENCE: 1→extract, 2→verify, 3→validate expiry, 4→attach context, 5→check permissions. Flag jwt.decode (not verify), missing exp checks, auth logic outside ${authFile}, and auth routes without rate limiting.`,
					scope: langGlob(ctx),
					severity: "error",
				},
			};
		},
	},

	// 3. ORM / Database
	{
		name: "database-orm",
		category: "database",
		detect(ctx) {
			const prisma = hasDependency(ctx, "@prisma/client", "prisma");
			const typeorm = hasDependency(ctx, "typeorm");
			const drizzle = hasDependency(ctx, "drizzle-orm");
			const sequelize = hasDependency(ctx, "sequelize");
			const mongoose = hasDependency(ctx, "mongoose");
			const knex = hasDependency(ctx, "knex");
			const sqlalchemy = hasDependency(ctx, "sqlalchemy", "SQLAlchemy");
			const django = hasDependency(ctx, "django", "Django");
			const orm =
				prisma || typeorm || drizzle || sequelize || mongoose || knex || sqlalchemy || django;

			// More specific DB patterns — avoid matching numpy/file operations
			const evidence = searchFiles(ctx, [
				"$transaction",
				".transaction(",
				"session.begin",
				"session.commit",
				"atomic(",
				"findUnique(",
				"findOne(",
				"db.query(",
				"db.execute(",
				"db.session.",
				"cursor.execute",
			]);

			if (!orm && evidence.length < 3) return null;

			const ormName = orm || "database";
			const txMethod = prisma
				? "db.$transaction"
				: typeorm
					? "queryRunner.startTransaction"
					: drizzle
						? "db.transaction"
						: "db.transaction";

			return {
				category: "database",
				label: `${ormName} detected`,
				evidence: evidence.slice(0, 5),
				purposeData: {
					id: "transaction-safety",
					purpose:
						"Read-modify-write operations on shared state must be wrapped in database transactions with proper isolation. Unbounded queries must have pagination. Deletions should be soft-delete unless explicitly justified. Without these, concurrent requests corrupt data and careless queries take down the DB.",
					violations: [
						"DB read followed by DB write on same record without transaction wrapping",
						"Balance/counter/inventory updates without optimistic locking (version/updatedAt check) or transactions",
						"Multiple sequential writes that should be atomic (e.g., order + inventory deduction)",
						"findMany/find without limit or pagination — unbounded queries on growing tables",
						"Hard delete (DELETE/destroy) on user-facing data instead of soft delete (deletedAt flag)",
						"Raw SQL with string interpolation instead of parameterized queries (SQL injection risk)",
						"Missing unique constraint or upsert for operations that should be idempotent",
					],
					good_example: {
						title: "Transaction + optimistic lock + pagination",
						code: `await ${txMethod}(async (tx) => {\n  const account = await tx.account.findUnique({ where: { id } });\n  if (account.version !== expectedVersion) throw new ConflictError();\n  await tx.account.update({\n    where: { id, version: expectedVersion },\n    data: { balance: account.balance - amount, version: { increment: 1 } }\n  });\n});\n\n// Paginated query\nawait db.user.findMany({ take: 20, skip: page * 20, orderBy: { createdAt: "desc" } });`,
					},
					bad_example: {
						title: "Unprotected + unbounded + hard delete",
						code: "const account = await db.account.findUnique({ where: { id } });\nawait db.account.update({ data: { balance: account.balance - amount } });\n// No transaction, no version check\n\nconst allUsers = await db.user.findMany(); // unbounded!\nawait db.user.delete({ where: { id } }); // hard delete, data gone forever",
					},
					context_hint: `Check for: 1) read-then-write without ${txMethod}, 2) findMany/find without take/limit, 3) .delete()/.destroy() without soft-delete pattern, 4) string concatenation in SQL queries, 5) missing version/updatedAt checks on concurrent-write-prone tables.`,
					scope: langGlob(ctx),
					severity: "error",
				},
			};
		},
	},

	// 4. Layer Structure (Clean Architecture / DDD)
	{
		name: "layer-structure",
		category: "architecture",
		detect(ctx) {
			const layerDirs = [
				"controllers",
				"handlers",
				"routes",
				"services",
				"usecases",
				"use-cases",
				"domain",
				"entities",
				"repositories",
				"infrastructure",
				"adapters",
			];

			const foundLayers: string[] = [];
			for (const dir of layerDirs) {
				const matching = ctx.files.filter((f) => f.includes(`/${dir}/`) || f.startsWith(`${dir}/`));
				if (matching.length > 0) foundLayers.push(dir);
			}

			if (foundLayers.length < 2) return null;

			const hasControllers = foundLayers.some((l) =>
				["controllers", "handlers", "routes"].includes(l),
			);
			const hasServices = foundLayers.some((l) =>
				["services", "usecases", "use-cases"].includes(l),
			);

			if (!hasControllers && !hasServices) return null;

			const controllerLayer =
				foundLayers.find((l) => ["controllers", "handlers", "routes"].includes(l)) || "controllers";
			const serviceLayer =
				foundLayers.find((l) => ["services", "usecases", "use-cases"].includes(l)) || "services";

			return {
				category: "architecture",
				label: `Layer structure: ${foundLayers.join(", ")}`,
				evidence: foundLayers.map((l) => ({
					file: `${l}/`,
					snippet: `Directory found: ${l}/`,
				})),
				purposeData: {
					id: "layer-boundary",
					purpose: `Each layer must handle only its own responsibility. ${controllerLayer}/ handles HTTP, ${serviceLayer}/ handles business logic. When HTTP concerns (status codes, response format) leak into ${serviceLayer}/, or when business logic lives in ${controllerLayer}/, transport replacement becomes impossible and testing becomes brittle.`,
					violations: [
						`${serviceLayer}/ returning HTTP status codes, response objects, or headers`,
						`${controllerLayer}/ containing business logic (validation, calculations, state transitions)`,
						"Domain entities importing framework-specific types (ORM decorators, HTTP types)",
						"Inner layers importing from outer layers",
					],
					good_example: {
						title: "Service returns business result",
						code: `// ${serviceLayer}/user.ts\nclass UserService {\n  async activate(userId: string): Promise<User> {\n    const user = await this.repo.findById(userId);\n    return user.activate(); // business result only\n  }\n}`,
					},
					bad_example: {
						title: "HTTP concerns in service",
						code: `// ${serviceLayer}/user.ts\nclass UserService {\n  async activate(userId: string) {\n    const user = await this.repo.findById(userId);\n    user.activate();\n    return { status: 200, body: { user, message: "activated" } };\n    // HTTP leaked into business layer\n  }\n}`,
					},
					context_hint: `Check return types of functions in ${serviceLayer}/. They should return domain objects, not HTTP structures. Check ${controllerLayer}/ for business logic that should be in ${serviceLayer}/.`,
					scope: `{${controllerLayer},${serviceLayer}}/${langGlob(ctx).replace("**/", "")}`,
					severity: "warning",
				},
			};
		},
	},

	// 6. Test patterns
	{
		name: "test-framework",
		category: "testing",
		detect(ctx) {
			const jest = hasDependency(ctx, "jest", "@jest/core");
			const vitest = hasDependency(ctx, "vitest");
			const mocha = hasDependency(ctx, "mocha");
			const pytest = ctx.files.some((f) => f.includes("conftest.py") || f.includes("test_"));
			const framework = jest || vitest || mocha || (pytest ? "pytest" : null);

			if (!framework) return null;

			const testFiles = ctx.files.filter(
				(f) => f.includes(".test.") || f.includes(".spec.") || f.includes("test_"),
			);

			if (testFiles.length < 3) return null;

			// Check for weak patterns
			const weakEvidence = searchFiles(
				ctx,
				["toBeDefined()", "toBeTruthy()", ".toThrow()", "expect(result)"],
				["**/*.test.*", "**/*.spec.*", "**/test_*"],
			);

			return {
				category: "testing",
				label: `${framework} with ${testFiles.length} test files`,
				evidence: weakEvidence.slice(0, 5),
				purposeData: {
					id: "test-integrity",
					purpose: `Tests must validate actual business behavior, not just existence. Every test should answer: "what breaks if this code is wrong?" If the answer is "nothing", the test is useless. Mocking should be minimal — mock boundaries (APIs, DB), not internal logic.`,
					violations: [
						"Tests with no assertions or only trivial assertions (toBeDefined, toBeTruthy, assertIsNotNone)",
						"Tests verifying mock call order instead of business outcomes",
						"Overly broad error catches (.toThrow() / pytest.raises(Exception)) without specific error type",
						"Test descriptions that don't match what's actually tested",
						"Mocking internal functions instead of external boundaries — tests pass but production breaks",
						"Tests that pass even when the implementation is commented out (no real coverage)",
						"Snapshot tests on large objects that get auto-updated without review",
						"Missing edge cases: empty input, null, boundary values, concurrent access",
					],
					good_example: {
						title: "Behavior-focused test with edge case",
						code: `test("insufficient balance rejects withdrawal and preserves balance", async () => {\n  const account = new Account({ balance: 100 });\n  await expect(account.withdraw(200))\n    .rejects.toThrow(InsufficientBalanceError);\n  expect(account.balance).toBe(100); // balance unchanged\n});\n\ntest("zero amount withdrawal throws InvalidAmountError", async () => {\n  await expect(account.withdraw(0)).rejects.toThrow(InvalidAmountError);\n});`,
					},
					bad_example: {
						title: "Trivial test with internal mocking",
						code: `test("creates user", async () => {\n  jest.spyOn(repo, "save").mockResolvedValue({ id: 1 });\n  const user = await userService.create({ name: "test" });\n  expect(user).toBeDefined(); // tells nothing\n  expect(repo.save).toHaveBeenCalledTimes(1); // tests mock, not behavior\n});`,
					},
					context_hint:
						"Check: 1) sole assertions being toBeDefined/toBeTruthy, 2) jest.spyOn on internal modules instead of external APIs, 3) .toThrow() without error class, 4) test names vs actual assertions mismatch, 5) missing edge case tests for new business logic.",
					scope: ctx.primaryLang === "py" ? "**/test_*.py" : "**/*.{test,spec}.{ts,js,tsx,jsx}",
					severity: "warning",
				},
			};
		},
	},

	// 7. Design System Enforcement
	{
		name: "design-system",
		category: "design",
		detect(ctx) {
			// Detect UI framework first
			const react = hasDependency(ctx, "react", "next", "react-dom");
			const vue = hasDependency(ctx, "vue", "nuxt");
			const svelte = hasDependency(ctx, "svelte", "@sveltejs/kit");
			const uiFramework = react || vue || svelte;

			if (!uiFramework) return null;

			// Detect design system
			const shadcn = hasDependency(ctx, "@radix-ui/react-slot", "@radix-ui/react-dialog");
			const mui = hasDependency(ctx, "@mui/material", "@mui/joy");
			const antd = hasDependency(ctx, "antd", "@ant-design/icons");
			const chakra = hasDependency(ctx, "@chakra-ui/react");
			const mantine = hasDependency(ctx, "@mantine/core");
			const tailwind = hasDependency(ctx, "tailwindcss");

			// Check for custom tokens/theme files
			const themeFiles = hasFiles(ctx, ["theme", "tokens", "design-system", "design-tokens"]);
			const componentLib = hasFiles(ctx, [
				"ui/button",
				"ui/input",
				"ui/modal",
				"ui/dialog",
				"components/ui",
			]);

			const dsName = shadcn
				? "shadcn/ui"
				: mui
					? "MUI"
					: antd
						? "Ant Design"
						: chakra
							? "Chakra UI"
							: mantine
								? "Mantine"
								: null;

			// Need either a known DS or custom component lib
			if (!dsName && componentLib.length < 2 && themeFiles.length === 0) return null;

			const systemLabel = dsName || "custom component library";
			const tokenFile = themeFiles.length > 0 ? themeFiles[0] : "your design tokens file";

			// Find evidence of raw HTML/inline styles
			const rawEvidence = searchFiles(
				ctx,
				[
					"style={{",
					'className="bg-',
					"text-gray-",
					"text-blue-",
					"text-red-",
					"bg-gray-",
					"bg-blue-",
					"bg-white",
					"bg-black",
					"#ffffff",
					"#000000",
					"color:",
					"font-size:",
					"<button",
					"<input ",
				],
				[`**/*.${react ? "tsx" : vue ? "vue" : "svelte"}`],
			);

			return {
				category: "design",
				label: `${systemLabel} detected${tailwind ? " + Tailwind" : ""}`,
				evidence: [
					...componentLib.slice(0, 2).map((f) => ({ file: f, snippet: `Component library: ${f}` })),
					...themeFiles.slice(0, 2).map((f) => ({ file: f, snippet: `Theme/tokens: ${f}` })),
					...rawEvidence.slice(0, 3),
				].slice(0, 5),
				purposeData: {
					id: "design-system",
					purpose: `All UI must use ${systemLabel} components and design tokens. Raw HTML elements (<button>, <input>), inline styles, and hardcoded colors/spacing bypass the design system, causing visual inconsistency, accessibility gaps, and theme-breaking changes.`,
					violations: [
						`Raw HTML elements (<button>, <input>, <select>) instead of ${systemLabel} components`,
						"Inline styles (style={{}}) instead of design tokens or utility classes",
						"Raw Tailwind color classes (text-gray-900, bg-blue-500) instead of semantic tokens (text-primary, bg-accent)",
						"Hardcoded color values (#fff, rgb(), hsl()) instead of theme tokens",
						"Hardcoded spacing/font-size values instead of scale tokens",
						`New UI components that don't extend from ${systemLabel} primitives`,
					],
					good_example: {
						title: `Using ${systemLabel} components`,
						code: react
							? `import { Button } from "@/components/ui/button";\nimport { Input } from "@/components/ui/input";\n\n<Button variant="primary" size="md">\n  Submit\n</Button>`
							: `<Button variant="primary" size="md">Submit</Button>`,
					},
					bad_example: {
						title: "Raw HTML with inline styles",
						code: `<button\n  style={{ backgroundColor: "#3b82f6", padding: "8px 16px", borderRadius: "4px" }}\n>\n  Submit\n</button>\n// Bypasses theme, breaks dark mode, inconsistent with other buttons`,
					},
					context_hint: `Scan for raw HTML form elements and inline style={{}} in component files. Every <button>, <input>, <select>, <textarea> should use ${systemLabel}. Check for hardcoded hex/rgb colors outside ${tokenFile}.`,
					scope: langGlob(ctx),
					severity: "warning",
				},
			};
		},
	},

	// 8. Error Handling
	{
		name: "error-handling",
		category: "reliability",
		detect(ctx) {
			const evidence = searchFiles(ctx, [
				"catch {}",
				"catch (e) {}",
				"catch (err) {}",
				"catch (error) {}",
				"catch (_)",
				"except:",
				"except Exception:",
				"console.log(err",
				"console.log(error",
				"console.error(e)",
				".catch(() =>",
			]);

			if (evidence.length < 2) return null;

			return {
				category: "reliability",
				label: `${evidence.length} error handling patterns found`,
				evidence: evidence.slice(0, 5),
				purposeData: {
					id: "error-handling",
					purpose:
						"Errors must be handled explicitly: catch blocks must either recover, re-throw with context, or log with structured data — never swallow silently. Unhandled promise rejections and generic catch-all blocks are the #1 cause of invisible production failures.",
					violations: [
						"Empty catch block — error silently swallowed, no logging, no recovery",
						"catch block with only console.log — no structured logging, no error tracking",
						"Generic catch-all (catch(e){}) without re-throwing or handling specific error types",
						"Promise without .catch() or try/catch — unhandled rejection crashes process",
						"Error message is generic ('Something went wrong') — no context for debugging",
						"Stack trace or internal error details exposed in API response to client",
						"Async function without top-level try/catch — errors disappear silently",
					],
					good_example: {
						title: "Structured error handling with context",
						code: `try {\n  await processPayment(order);\n} catch (error) {\n  if (error instanceof InsufficientBalanceError) {\n    return res.status(402).json({ code: "INSUFFICIENT_BALANCE" });\n  }\n  logger.error("Payment failed", { orderId: order.id, error: error.message, stack: error.stack });\n  throw error; // re-throw unexpected errors\n}`,
					},
					bad_example: {
						title: "Swallowed error",
						code: "try {\n  await processPayment(order);\n} catch (e) {\n  console.log(e); // logged to stdout, lost in production\n  // error swallowed — caller thinks payment succeeded\n}",
					},
					context_hint:
						"Search for empty catch blocks, catch blocks with only console.log, .catch(() => {}), and async functions without error handling. Every catch should either recover (return fallback), re-throw with context, or log with structured data (logger, not console).",
					scope: langGlob(ctx),
					severity: "warning",
				},
			};
		},
	},

	// 9. Secret / Credential Leakage
	{
		name: "secret-leakage",
		category: "security",
		detect(ctx) {
			const evidence = searchFiles(ctx, [
				"sk_live_",
				"sk_test_",
				"AKIA",
				"api_key =",
				"apiKey:",
				"secret =",
				"password =",
				"SECRET_KEY",
				"PRIVATE_KEY",
			]);

			// Check for .env in git
			const envFiles = ctx.files.filter(
				(f) => f === ".env" || f === ".env.local" || f === ".env.production",
			);

			if (evidence.length < 1 && envFiles.length === 0) return null;

			return {
				category: "security",
				label: `${evidence.length} potential secret patterns${envFiles.length ? " + .env files tracked" : ""}`,
				evidence: [
					...envFiles.map((f) => ({ file: f, snippet: "WARNING: .env file tracked in git" })),
					...evidence,
				].slice(0, 5),
				purposeData: {
					id: "secret-safety",
					purpose:
						"Secrets (API keys, tokens, passwords, private keys) must NEVER appear in source code, git history, logs, or API responses. All secrets must come from environment variables or a secrets manager. .env files must be in .gitignore.",
					violations: [
						"API keys, tokens, or passwords hardcoded in source files",
						".env or .env.production tracked in git (must be in .gitignore)",
						"Secrets logged in error messages, console.log, or structured logs",
						"API error responses exposing internal stack traces, DB connection strings, or config values",
						"Secret values in client-side code (React components, browser JS) — visible to users",
						"Default/fallback secret values in code (const secret = process.env.SECRET || 'default-key')",
						"Secrets committed in previous git commits even if removed from current code",
					],
					good_example: {
						title: "Secrets from environment",
						code: `const stripeKey = process.env.STRIPE_SECRET_KEY;\nif (!stripeKey) throw new Error("STRIPE_SECRET_KEY not configured");\n\n// .gitignore\n.env\n.env.*\n\n// Error response — no internals\nres.status(500).json({ error: "Internal server error", requestId });`,
					},
					bad_example: {
						title: "Hardcoded secrets",
						code: `const stripe = new Stripe("sk_live_abc123def456");\nconst dbUrl = "postgresql://admin:password123@prod-db:5432/app";\n\n// Logged to stdout\nconsole.log("Auth failed for token:", req.headers.authorization);`,
					},
					context_hint:
						"Search for: sk_live_, sk_test_, AKIA (AWS), hardcoded strings assigned to variables named key/secret/password/token, .env files not in .gitignore, console.log/logger calls that include token/key/secret variables, and error responses that include stack traces.",
					scope: langGlob(ctx),
					severity: "error",
				},
			};
		},
	},

	// 10. API Contract Safety
	{
		name: "api-contract",
		category: "api",
		detect(ctx) {
			const hasApi = ctx.files.some(
				(f) =>
					f.includes("routes/") ||
					f.includes("controllers/") ||
					f.includes("handlers/") ||
					f.includes("api/"),
			);

			const evidence = searchFiles(ctx, [
				"res.json(",
				"res.send(",
				"res.status(",
				"jsonify(",
				"JsonResponse(",
				"Response(",
				"@Get(",
				"@Post(",
				"@app.route",
				"router.get(",
				"router.post(",
			]);

			if (!hasApi || evidence.length < 3) return null;

			// Check for validation libraries
			const zod = hasDependency(ctx, "zod");
			const joi = hasDependency(ctx, "joi");
			const classValidator = hasDependency(ctx, "class-validator");
			const pydantic = hasDependency(ctx, "pydantic");
			const validator = zod || joi || classValidator || pydantic;

			return {
				category: "api",
				label: `API endpoints detected${validator ? ` + ${validator} validation` : ""}`,
				evidence: evidence.slice(0, 5),
				purposeData: {
					id: "api-contract",
					purpose:
						"API endpoints must validate all input at the boundary, return consistent response shapes, and never break existing clients. Input validation → business logic → consistent response is the required sequence. Missing validation means untrusted data hits your database. Inconsistent responses break mobile apps silently.",
					violations: [
						"SEQUENCE BREAK: Request body used directly without validation/parsing (req.body.email without schema check)",
						"MISSING STEP: No input validation on POST/PUT/PATCH endpoints — raw user input reaches DB or services",
						"CONTRACT BREAK: Response shape changes between success/error (sometimes {data}, sometimes {result}, sometimes raw array)",
						"CONTRACT BREAK: Nullable field added to response without versioning — existing clients crash on null",
						"LEAK: Error responses exposing stack traces, SQL errors, or internal implementation details",
						"MISSING: No pagination on list endpoints — response grows unbounded with data",
						"MISSING: No request size limit — large payloads cause OOM or slow processing",
					],
					good_example: {
						title: "Validated input, consistent response",
						code: `// Step 1: VALIDATE at boundary\nconst input = createUserSchema.parse(req.body);\n// Step 2: BUSINESS LOGIC with validated data\nconst user = await userService.create(input);\n// Step 3: CONSISTENT response shape\nres.json({ data: user, meta: { requestId } });\n\n// Error shape matches\nres.status(400).json({ error: { code: "VALIDATION_ERROR", details } });`,
					},
					bad_example: {
						title: "No validation, inconsistent response",
						code: "// Raw input — SQL injection, type errors, garbage data\nconst user = await db.user.create({ data: req.body });\n// Sometimes returns array, sometimes object\nres.json(users); // vs res.json({ data: user })\n// Error leaks internals\nres.status(500).json({ error: err.message, stack: err.stack });",
					},
					context_hint:
						"Check every POST/PUT/PATCH handler for input validation as the FIRST operation. Check response shapes for consistency (always {data} or always {items, total}). Check error handlers for internal detail leakage.",
					scope: langGlob(ctx),
					severity: "warning",
				},
			};
		},
	},

	// 11. N+1 / Performance Anti-patterns
	{
		name: "performance",
		category: "performance",
		detect(ctx) {
			const orm = hasDependency(
				ctx,
				"@prisma/client",
				"typeorm",
				"drizzle-orm",
				"sequelize",
				"mongoose",
				"sqlalchemy",
				"django",
			);

			const evidence = searchFiles(ctx, [
				"for (const",
				"for (let",
				"forEach(",
				"for await",
				".map(async",
				"Promise.all",
				"findUnique(",
				"findOne(",
				"findById(",
				".get(",
			]);

			// Look specifically for await-in-loop patterns
			const loopAwaitEvidence = searchFiles(ctx, ["await "], ["**/*.{ts,js,py}"]);

			if (!orm && evidence.length < 3) return null;

			return {
				category: "performance",
				label: `${orm || "database"} + loop patterns detected`,
				evidence: evidence.slice(0, 5),
				purposeData: {
					id: "performance-safety",
					purpose:
						"Database queries must never run inside loops (N+1 problem). Parallelizable async operations must not be sequential. Data filtering must happen in the query, not in application memory. These patterns cause linear or exponential slowdown as data grows.",
					violations: [
						"N+1: DB query inside a for/forEach/map loop — use batch query or join instead",
						"SEQUENTIAL: await inside for-loop for independent operations — use Promise.all",
						"MEMORY: Loading all records then filtering in JS/Python (findMany → .filter) instead of WHERE clause",
						"UNBOUNDED: Query without limit/pagination on user-facing endpoint — response time grows with data",
						"MISSING: No index hint for frequently filtered/sorted columns — full table scan",
						"BLOCKING: CPU-intensive operation (JSON.parse of large payload, crypto, image processing) on main thread without worker",
					],
					good_example: {
						title: "Batch query + parallel execution",
						code: "// Batch: one query instead of N\nconst users = await db.user.findMany({\n  where: { id: { in: userIds } },\n  take: 20, // bounded\n});\n\n// Parallel: independent operations\nconst [profile, orders, settings] = await Promise.all([\n  getProfile(userId),\n  getOrders(userId),\n  getSettings(userId),\n]);",
					},
					bad_example: {
						title: "N+1 + sequential + memory filter",
						code: "// N+1: query per iteration\nfor (const orderId of orderIds) {\n  const order = await db.order.findUnique({ where: { id: orderId } });\n  results.push(order);\n}\n\n// Memory filter: loads ALL then filters\nconst allUsers = await db.user.findMany();\nconst active = allUsers.filter(u => u.active);",
					},
					context_hint:
						"Search for await/query calls inside for/forEach/map loops. Check findMany/find calls for missing where/limit. Look for .filter() after findMany (should be WHERE clause). Check sequential awaits that could be Promise.all.",
					scope: langGlob(ctx),
					severity: "warning",
				},
			};
		},
	},
];
