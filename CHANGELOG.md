# Changelog

## 1.0.0 — 2026-11-07

First public release.

- Live dashboard with every process listening on a TCP port: project, framework, folder, uptime, memory, HTTP status and page title.
- Exposed ports (`0.0.0.0`) are flagged.
- Stop button: SIGTERM on a double click, SIGKILL on shift-click.
- CLI: `zoo list`, `zoo kill <port>`, `zoo --json`, `zoo --version`.
- `zoo --demo` with fake servers.
- macOS (`lsof`) and Linux (`ss`, falls back to `lsof`).
- Binds to `127.0.0.1`; `Host` check, per-run token, token required for every request on non-loopback addresses.
- Light and dark themes.
- README in English and Russian.
