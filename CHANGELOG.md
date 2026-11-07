# Changelog

## 1.2.0 — 2026-11-07

- **Telegram bot** (`zoo telegram`): every process in a chat, with details, fixes and Stop buttons. Setup asks for a BotFather token (hidden input, saved with `chmod 600`) and pairs the bot to one owner with a one-time code; everyone else is turned away. `zoo telegram service` prints a systemd unit to keep it running.
- **How to fix.** Every exposed dev server gets copy-paste fixes for its stack (Vite, Next.js, Uvicorn, Django, Flask, Redis, Postgres, MySQL, MongoDB, Elasticsearch, Docker compose / run, ufw, SSH tunnel) and a plain-words note on what is at risk. Shown in the dashboard, `zoo top`, `zoo list`, the bot and MCP.
- **systemd.** Processes show their unit (`nginx.service`) and Stop uses `systemctl stop`, so services don't restart right away.
- **Protected processes.** sshd, Docker and init can't be stopped from the dashboard, the bot, `zoo top`, `zoo kill` or MCP.
- Containers are now recognised by image (`redis:7` → Redis), plus Elasticsearch, Memcached, RabbitMQ, ClickHouse, Grafana, Prometheus, MinIO, Kibana and an open Docker API.
- README: Hall of shame, Telegram section, FAQ.

## 1.1.0 — 2026-11-07

- **`zoo top`**: a live htop-style view in the terminal. Move with arrows or `j`/`k`, stop with `s`/`S`, filter with `/`. Made for SSH sessions.
- **Docker containers by name.** `docker-proxy` and Docker Desktop listeners turn into `shop-db-1 · postgres:16` with the compose project and folder. Stop runs `docker stop` (`docker kill` with force).
- **Who can reach a port.** Every port is `local`, `firewalled`, `network` or `INTERNET`, based on public IPs and `ufw` rules. Docker ports published past ufw are flagged. The dashboard shows a red banner, and `zoo list` gets a REACH column.
- **`zoo mcp`**: an MCP server with `list_servers`, `who_is_on_port`, `stop_server` and `check_exposure`, for Claude Code, Cursor and other agents.
- `--demo` now works with every command.
- `zoo kill <port>` stops containers too.
- Demo GIF in the README.

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
