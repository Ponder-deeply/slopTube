// Runs the Claude Code CLI headless on one note: the vault's improve-prose skill.
// Desktop only. Obsidian's Flatpak cannot spawn on the host, but it sees $HOME, and the
// native CLI runs inside the sandbox, so it is spawned directly through Electron's Node.

/// <reference types="node" />
import type * as ChildProcess from "child_process";
import type * as Os from "os";

/** Electron's Node require; undefined on mobile. Bypasses the bundler on purpose. */
const nodeRequire = (window as unknown as { require?: (id: string) => unknown }).require;

/** A run still going after this is killed. */
const TIMEOUT_MS = 5 * 60_000;
/** Output kept per stream while running, and the tail shown in the finishing notice. */
const BUFFER_CHARS = 8000;
const TAIL_CHARS = 600;

/** Exactly the tools .claude/skills/improve-prose/SKILL.md uses; anything else is denied. */
const ALLOWED_TOOLS = [
	"Read",
	"Edit",
	"Bash(date:*)",
	"Bash(grep:*)",
	"Bash(python3 Wiki/scripts/lint.py:*)",
	"Bash(python3 Wiki/scripts/gen_state.py:*)",
];

export interface CliResult {
	ok: boolean;
	/** The CLI's final reply on success; the reason and stderr tail on failure. */
	message: string;
}

/** The native installer's location, ~/.local/bin/claude; bare "claude" where there is no Node. */
export function defaultClaudePath(): string {
	const os = nodeRequire?.("os") as typeof Os | undefined;
	return os ? `${os.homedir()}/.local/bin/claude` : "claude";
}

/** The CLI arguments for one improve-prose run on a vault-relative path. */
export function proseArgs(path: string): string[] {
	return ["-p", `/improve-prose ${path}`, "--permission-mode", "acceptEdits", "--permission-prompts", "none", "--allowedTools", ...ALLOWED_TOOLS];
}

/** Tracks runs per note, so a note is never rewritten by two runs at once. */
export class ProseRunner {
	private running = new Set<string>();

	isRunning(path: string): boolean {
		return this.running.has(path);
	}

	/** Marks the note busy immediately; resolves when the CLI exits or is killed. */
	run(path: string, cli: string, cwd: string): Promise<CliResult> {
		this.running.add(path);
		return spawnCli(cli, proseArgs(path), cwd).finally(() => this.running.delete(path));
	}
}

function spawnCli(cli: string, args: string[], cwd: string): Promise<CliResult> {
	const cp = nodeRequire?.("child_process") as typeof ChildProcess | undefined;
	if (!cp) return Promise.resolve({ ok: false, message: "A Claude CLI csak asztali Obsidianból indítható." });
	return new Promise((resolve) => {
		let out = "";
		let err = "";
		let timedOut = false;
		const child = cp.spawn(cli, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
		const timer = window.setTimeout(() => {
			timedOut = true;
			child.kill("SIGTERM");
		}, TIMEOUT_MS);
		child.stdout?.on("data", (d: Buffer) => (out = (out + d.toString()).slice(-BUFFER_CHARS)));
		child.stderr?.on("data", (d: Buffer) => (err = (err + d.toString()).slice(-BUFFER_CHARS)));
		// A failed spawn (e.g. wrong path) emits "error" and possibly "close"; the first resolve wins.
		child.on("error", (e) => {
			window.clearTimeout(timer);
			resolve({ ok: false, message: `Nem indítható: ${cli}\n${e.message}` });
		});
		child.on("close", (code) => {
			window.clearTimeout(timer);
			if (timedOut) resolve({ ok: false, message: `Időtúllépés (${TIMEOUT_MS / 60_000} perc), a futás leállítva.\n${tail(err || out)}` });
			else if (code === 0) resolve({ ok: true, message: tail(out) });
			else resolve({ ok: false, message: `Kilépési kód: ${code}\n${tail(err || out)}` });
		});
	});
}

function tail(s: string): string {
	const t = s.trim();
	return t.length > TAIL_CHARS ? `…${t.slice(-TAIL_CHARS)}` : t;
}
