# Agent Fleet Console v2

Real-time chat dashboard for the GitHub-powered OpenCode agent fleet (282 agents).

## How it works

1. **Select an agent** from the left panel (282 agents, filterable by provider).
2. **Type your task** in the chat input and press Enter.
3. A **prefilled GitHub issue** opens in a new tab — click "Submit issue" to create it.
4. The **fleet worker** picks up the issue, runs the agent via `opencode run --agent <slug> --model <model>`, and posts the result as a comment.
5. The dashboard **polls every 5s** and renders the agent's reply in the chat view.

## Repos

| Repo | Role |
|---|---|
| `krisharyanagarwal-dev/agent-fleet-console` | Dashboard + issue queue (public, GitHub Pages) |
| `krisharyanagarwal-dev/openalice-fleet` | Agents, worker daemon, provider API calls (private) |

## Flow

```
Dashboard chat → prefilled GitHub issue → dispatch.yml (Actions)
  → engine inbox → worker_daemon.py → task-ctl claim → opencode run
    → task-ctl complete → comment on issue → dashboard polls & renders
```

## Setup

1. Enable GitHub Pages on `agent-fleet-console` (source: `gh-pages` branch).
2. Add `CONSOLE_DISPATCH_TOKEN` secret to the console repo (PAT with `contents:write` on the engine repo).
3. Add `CONSOLE_DISPATCH_TOKEN` to the worker host env (`~/.config/openalice-fleet/fleet.env`).
4. Start `services/worker_daemon.py` on the mini or laptop.

## Why GitHub Issues as the queue

- Issues are public, searchable, and version-controlled
- Comments are the result channel — no separate result store
- Labels (`agent:<slug>`, `status:done|failed|stalled`) give instant status
- Zero infrastructure: GitHub hosts UI, queue, and history for free
