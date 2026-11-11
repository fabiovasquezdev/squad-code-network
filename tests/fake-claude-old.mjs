#!/usr/bin/env node
// Stand-in for an older Claude Code that rejects --forward-subagent-text (e.g. 2.1.153); everything else behaves like fake-claude.mjs.
if (process.argv.includes('--forward-subagent-text')) { console.error("error: unknown option '--forward-subagent-text'"); process.exit(1); }
await import('./fake-claude.mjs');
