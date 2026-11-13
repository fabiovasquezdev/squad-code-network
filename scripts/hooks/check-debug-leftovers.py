#!/usr/bin/env python3
"""Claude Code PostToolUse hook for Write|Edit: flags obvious debug-leftover statements in the
file that was just written, without spending any model tokens on the check. Stdin is the hook's
standard JSON payload (tool_input.file_path identifies the file); stdout is a {"decision":"block",
"reason":...} object that Claude Code feeds back to the agent as feedback (the file write itself
already happened and is not undone — see squad-code-network's server.js, which wires this in only
for the Claude engine: Antigravity's own .agents/hooks.json / ~/.gemini/config/hooks.json mechanism
did not fire in testing against agy 1.5.6, matching open upstream issues about it).

Deliberately narrow: only patterns with near-zero false-positive risk in committed code (debugger
statements, interactive breakpoints). Broader patterns (print(), console.log() analogues some
languages use legitimately for real output) are left out on purpose — a hook that cries wolf costs
more tokens arguing with it than it saves.
"""
import json
import re
import sys

PATTERNS = {
    ".js": [(r"console\.log\(", "console.log("), (r"\bdebugger\s*;", "debugger;")],
    ".jsx": [(r"console\.log\(", "console.log("), (r"\bdebugger\s*;", "debugger;")],
    ".ts": [(r"console\.log\(", "console.log("), (r"\bdebugger\s*;", "debugger;")],
    ".tsx": [(r"console\.log\(", "console.log("), (r"\bdebugger\s*;", "debugger;")],
    ".mjs": [(r"console\.log\(", "console.log("), (r"\bdebugger\s*;", "debugger;")],
    ".py": [(r"\bpdb\.set_trace\(\)", "pdb.set_trace()"), (r"\bbreakpoint\(\)", "breakpoint()")],
    ".rb": [(r"\bbinding\.pry\b", "binding.pry"), (r"\bbyebug\b", "byebug")],
    ".php": [(r"\bvar_dump\(", "var_dump("), (r"\bdd\(", "dd(")],
}
SKIP_PATH_PARTS = ("/test/", "/tests/", "/__tests__/", "/spec/", ".test.", ".spec.")


def main():
    try:
        payload = json.load(sys.stdin)
    except Exception:
        return
    file_path = (payload.get("tool_input") or {}).get("file_path") or ""
    if not file_path or any(part in file_path for part in SKIP_PATH_PARTS):
        return
    ext = next((e for e in PATTERNS if file_path.endswith(e)), None)
    if not ext:
        return
    try:
        with open(file_path, "r", encoding="utf-8", errors="ignore") as fh:
            lines = fh.readlines()
    except OSError:
        return
    hits = []
    for i, line in enumerate(lines, start=1):
        for pattern, label in PATTERNS[ext]:
            if re.search(pattern, line):
                hits.append(f"linha {i}: {label}")
    if not hits:
        return
    reason = (
        f"Sobrou resíduo de debug em {file_path}, remova antes de seguir:\n"
        + "\n".join(hits[:20])
    )
    print(json.dumps({"decision": "block", "reason": reason}))


if __name__ == "__main__":
    main()
