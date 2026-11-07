<div align="center">

# 🦝 localhost-zoo

**Every dev server on your machine in one live dashboard.**

Find out who is squatting on port 3000, which project it belongs to, and whether the whole internet can reach it. Then stop it in one click.

![Release](https://img.shields.io/github/v/release/koigkio/localhost-zoo?color=2f7d4f)
![Node.js](https://img.shields.io/badge/Node.js-18%2B-5FA04E?logo=node.js&logoColor=white)
![Platforms](https://img.shields.io/badge/platform-macOS%20%7C%20Linux-lightgrey)
![Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)
![MCP](https://img.shields.io/badge/MCP-server-D97757)
![License](https://img.shields.io/badge/license-MIT-blue)

dashboard · terminal UI · Docker-aware · internet exposure check · MCP for AI agents · zero dependencies

[Русская версия](README.ru.md)

<img src="assets/demo.gif" alt="localhost-zoo: a Redis container is flagged as open to the internet, one click stops it and the warning disappears" width="820">

</div>

---

## ✨ Features

- 🔎 **Finds everything that listens.** Vite, Next.js, Django, Rails, Uvicorn, Jupyter, Postgres, Redis, a forgotten `python -m http.server`…
- 🐳 **Knows your containers.** Instead of an anonymous `docker-proxy` you see `shop-db-1 · postgres:16`, with the compose project. Stop runs `docker stop`.
- 🌍 **Tells you what the internet can reach.** It checks public IPs and ufw rules, and catches the classic trap: Docker publishes ports past ufw.
- 🖥 **`zoo top`.** A live, htop-style view right in the terminal. Made for SSH sessions.
- 🤖 **MCP server.** Claude Code, Cursor and other agents can ask “what is on port 3000?” and free it.
- 📁 **Knows where each process came from.** Shows the folder, the project name from `package.json`, `pyproject.toml`, `go.mod` or `Cargo.toml`, and the framework.
- 🌐 **Peeks at the page.** Shows the HTTP status and the `<title>`, so “:5173” becomes “Shop — dev”.
- 🛑 **Stops processes.** Click Stop twice for SIGTERM, shift-click for SIGKILL.
- 🦉 **Hides the noise.** System listeners stay out of the way until you ask for them.

## 🚀 Install

```bash
npm install -g github:koigkio/localhost-zoo
```

Then run:

```bash
zoo
```

The dashboard opens at http://localhost:4321.

**Requires** Node.js 18 or newer.

| System | What to do |
|---|---|
| macOS | `brew install node`, or download it from [nodejs.org](https://nodejs.org) |
| Ubuntu / Debian | `curl -fsSL https://deb.nodesource.com/setup_22.x \| sudo -E bash - && sudo apt-get install -y nodejs` |
| Other Linux | [nodejs.org/en/download](https://nodejs.org/en/download) |

Just want to look? Add `--demo` to any command, and you get fake servers where nothing is stopped for real.

## 🎛 Commands

| Command | What it does |
|---|---|
| `zoo` | open the dashboard |
| `zoo top` | live view in the terminal |
| `zoo list` | dev servers as a table, with who can reach them |
| `zoo list --all` | the same, including system listeners |
| `zoo kill 3000` | stop whatever listens on port 3000, process or container |
| `zoo kill 3000 -f` | the same, with SIGKILL / `docker kill` |
| `zoo mcp` | MCP server for AI agents |
| `zoo --json` | the raw scan as JSON, for scripts |

| Option | Default | Meaning |
|---|---|---|
| `-p`, `--port` | `4321` | dashboard port |
| `-H`, `--host` | `127.0.0.1` | bind address; anything other than loopback requires a token |
| `--no-open` | | don't open a browser |
| `--demo` | | fake data, works with every command |

## 🖥 `zoo top`

```
 🦝 localhost zoo — devbox                         8 dev · 2 system   public IP 203.0.113.7 · ufw active
 ⚠ Open to the internet: shop-cache-1 :6379

    PORT          NAME                   KIND         UP    MEM    REACH      WHERE
  🦖 :5173         shop-frontend          Vite         2h    178M   local      ~/code/shop/frontend
  🐍 :8000         ml-api                 Uvicorn      1d    625M   firewalled ~/code/ml-api
▸ 🦊 :6379         shop-cache-1           Redis        2d           INTERNET   🐳 redis:7
  🐘 :5432         shop-db-1              PostgreSQL   2d           local      🐳 postgres:16
────────────────────────────────────────────────────────────────────────────────────────────────────
 container 3f9a1c2b7d4e · Up 2 days  redis:7  docker-entrypoint.sh redis-server
 internet: Docker publishes :6379 past ufw rules
────────────────────────────────────────────────────────────────────────────────────────────────────
 ↑↓ move  s stop  S force  / filter  a show system  r refresh  q quit
```

| Key | Action |
|---|---|
| `↑` `↓` or `j` `k` | move |
| `s` · `S` | stop · force-stop (asks first) |
| `/` | filter by port, name, image… |
| `a` | show or hide system listeners |
| `r` · `q` | refresh · quit |

## 🌍 Who can reach a port?

Every port gets one of four labels:

| Label | Meaning |
|---|---|
| `local` | listens on `127.0.0.1`, so only this machine can reach it |
| `firewalled` | listens on all interfaces, but ufw blocks it from the internet |
| `network` | reachable from your Wi-Fi, office or provider network |
| **`INTERNET`** | the server has a public IP and nothing blocks the port |

**The Docker trap.** `docker run -p 6379:6379 redis` opens Redis to the whole internet even when `ufw` denies the port, because Docker writes its own iptables rules. localhost-zoo flags it in red. The fix is to publish on localhost only: `-p 127.0.0.1:6379:6379`.

To read ufw rules and every process, run `sudo zoo`.

## 🤖 For AI agents (MCP)

`zoo mcp` is a [Model Context Protocol](https://modelcontextprotocol.io) server. With it, your coding agent can check a port before starting a dev server and free it without asking you to dig through `lsof`.

**Claude Code:**

```bash
claude mcp add localhost-zoo -- zoo mcp
```

**Cursor and others** (`mcp.json`):

```json
{ "mcpServers": { "localhost-zoo": { "command": "zoo", "args": ["mcp"] } } }
```

| Tool | What it does |
|---|---|
| `list_servers` | every dev server with port, project, framework, folder and HTTP title |
| `who_is_on_port` | what exactly is listening on a port |
| `stop_server` | stop a process or container on a port (marked destructive, so the agent asks first) |
| `check_exposure` | which ports are open to the internet or the network, and why |

## 🌐 On a remote server

On the server, `zoo top` is the quickest option.

For the web dashboard, open it through an SSH tunnel from your laptop:

```bash
ssh -L 4321:localhost:4321 root@your-server 'zoo --no-open'
```

Then open http://localhost:4321 on your laptop.

<details>
<summary><b>Opening it without a tunnel</b></summary>

```bash
zoo --host 0.0.0.0
```

It prints a link like `http://<server-ip>:4321/?t=<token>`. Without the token the dashboard does not open at all.

Keep in mind that the traffic is plain HTTP and the dashboard can stop any process the user can. Anyone who sees the link can do the same. Use this for a quick look, not as a permanent setup.

</details>

## ⚙️ How it works

```
zoo
 │
 ├─ who is listening?   macOS: lsof -iTCP -sTCP:LISTEN
 │                      Linux: ss -ltnp   (falls back to lsof)
 │
 ├─ containers          docker ps → names, images, compose projects
 │
 ├─ for every process   ps          → command, uptime, memory
 │                      cwd         → /proc/<pid>/cwd or lsof -d cwd
 │                      project     → nearest package.json / pyproject.toml / go.mod …
 │
 ├─ who can reach it    public IPs on the interfaces + ufw status verbose
 │
 ├─ HTTP probe          GET / with a 0.7 s timeout → status + <title>
 │
 └─ dashboard · zoo top · zoo list · zoo mcp
```

**Who is who:**

| | | | |
|---|---|---|---|
| 🦖 Node.js | 🐍 Python | 🦀 Rust | 🐹 Go |
| 🦕 Deno | 🐰 Bun | 🐞 Ruby | 🐘 PHP · PostgreSQL |
| 🐬 MySQL | 🦊 Redis | 🐳 Docker | 🪐 Jupyter |
| 🦜 Storybook | 🦉 system | 🦝 unknown | |

## 🛡 Safety

Stop really kills processes and containers, so the dashboard is careful:

- It listens on `127.0.0.1` by default.
- It checks the `Host` header, so a website you visit can't reach it through DNS rebinding.
- Stopping requires a random token, created on every start, and a request from the dashboard's own page.
- It only stops entries from the current scan: no arbitrary PIDs, and never itself.
- With `--host` set to anything other than loopback, every request requires the token.

## 🗺 Roadmap

- [x] macOS and Linux
- [x] Project and framework detection, HTTP probe
- [x] CLI: `list`, `kill`, `--json`, demo mode
- [x] Docker containers by name, `docker stop`
- [x] Internet exposure check (public IP, ufw, Docker vs ufw)
- [x] `zoo top` terminal UI
- [x] MCP server for AI agents
- [ ] Stop the whole process tree (`npm → node → vite`)
- [ ] firewalld and nftables
- [ ] Windows (`netstat -ano` + `Get-Process`)
- [ ] “Open in editor” and restart buttons
- [ ] Publish to npm

Adding a framework takes one line in `src/scan.js`.

## 📄 License

[MIT](LICENSE) © koigkio
