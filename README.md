# Agent Fleet Console

Public GitHub Pages dashboard for the OpenCode agent fleet.

- **Issues are tasks.** Every agent task is a GitHub issue titled `agent/<slug>: <subject>`.
- **Comments are results.** The worker posts each agent's answer as a comment on the issue.
- **No secrets in the browser.** The dashboard opens a prefilled issue; your GitHub account is the only credential used.
- **Zero-cost.** GitHub Pages + Issues + anonymous API reads (conditional requests, 304-friendly).

## Repos

| Repo | Role | Visibility |
|---|---|---|
| `goodwearrinfo-aryan/agent-fleet-console` | UI + issue queue mirror | Public |
| `krisharyanagarwal-dev/openalice-fleet` | Engine: agents, worker, provider API calls | Private |

## Setup

1. Create both repos (or use existing `openalice-fleet`).
2. In the private engine repo, add these secrets:
   - `CONSOLE_DISPATCH_TOKEN` — fine-grained PAT with `contents:write` on the console repo
   - `NVIDIA_API_KEY` + fallback keys, `GEMINI_API_KEY`, `GROQ_API_KEY`, `OPENROUTER_API_KEY`
3. Enable Pages on the console repo (source: `gh-pages` branch, `/docs` folder).
4. Start `services/worker_daemon.py` on the mini (or laptop hot standby).

## How it works

```
Dashboard → prefilled GitHub issue → dispatch.yml (routing only)
  → repository_dispatch → engine inbox → worker_daemon.py
    → task-ctl claim → opencode run → task-ctl complete
    → outbox → publish.yml → comment on the issue
  → dashboard polls Issues API (15 s)
```
