<div align="center">

# 🦝 localhost-zoo

**Every dev server on your machine in one live dashboard.**

Find out who is squatting on port 3000, which project it belongs to, and whether it is open to your whole network. Then stop it in one click.

![Release](https://img.shields.io/github/v/release/koigkio/localhost-zoo?color=2f7d4f)
![Node.js](https://img.shields.io/badge/Node.js-18%2B-5FA04E?logo=node.js&logoColor=white)
![Platforms](https://img.shields.io/badge/platform-macOS%20%7C%20Linux-lightgrey)
![Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)
![License](https://img.shields.io/badge/license-MIT-blue)

dashboard + CLI · zero dependencies · binds to localhost only · works over SSH

[Русская версия](README.ru.md)

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/dashboard-dark.png">
  <img src="assets/dashboard-light.png" alt="localhost-zoo dashboard: six dev servers (Vite, Next.js, Uvicorn, Jupyter, Rust, Go) with ports, page titles, folders and Stop buttons" width="820">
</picture>

</div>

---

## ✨ Features

- 🔎 **Finds everything that listens.** Vite, Next.js, Django, Rails, Uvicorn, Jupyter, Postgres, Redis, Docker, a forgotten `python -m http.server`…
- 📁 **Knows where it came from.** Shows the working folder and the project name from `package.json`, `pyproject.toml`, `go.mod` or `Cargo.toml`, and detects the framework from the command line.
- 🌐 **Peeks at the page.** Shows the HTTP status and the `<title>`, so “:5173” turns into “Shop — dev”.
- ⚠️ **Flags exposed ports.** A server on `0.0.0.0` can be reached from your Wi-Fi or the internet, and the dashboard marks it.
- 🛑 **Stops processes.** Click Stop twice to send SIGTERM. Shift-click to force it with SIGKILL.
- 🦉 **Hides the noise.** System listeners (sshd, AirPlay, VPN clients) are tucked away until you ask for them.
- 🖥 **CLI too.** `zoo list` and `zoo kill 3000` work right in the terminal.
- 🌗 **Light and dark themes**, live refresh, `/` to search.

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

Just want to look? `zoo --demo` opens the dashboard with fake servers, and nothing is stopped for real.

## 🎛 Commands

| Command | What it does |
|---|---|
| `zoo` | open the dashboard |
| `zoo list` | dev servers as a table in the terminal |
| `zoo list --all` | the same, including system listeners |
| `zoo kill 3000` | stop whatever listens on port 3000 |
| `zoo kill 3000 -f` | the same, with SIGKILL |
| `zoo --json` | the raw scan as JSON, for scripts |
| `zoo --demo` | the dashboard with fake data |

| Option | Default | Meaning |
|---|---|---|
| `-p`, `--port` | `4321` | dashboard port |
| `-H`, `--host` | `127.0.0.1` | bind address; anything other than loopback requires a token |
| `--no-open` | | don't open a browser |

```
PORT  PID    WHAT           KIND     UP  WHERE
3000  41388  admin          Next.js  1h  ~/code/shop/admin
5173  41210  shop-frontend  Vite     2h  ~/code/shop/frontend
8000  39001  ml-api         Uvicorn  1d  ~/code/ml-api
```

## 🌍 On a remote server

The dashboard listens only on the server's `127.0.0.1`, so nobody can reach it from outside. Open it through an SSH tunnel from your laptop:

```bash
ssh -L 4321:localhost:4321 root@your-server 'zoo --no-open'
```

Then open http://localhost:4321 on your laptop. The dashboard works while the SSH session is open.

To see processes owned by other users (system nginx, Postgres, Docker), run `zoo` as root.

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
 ├─ for every process   ps          → command, uptime, memory
 │                      cwd         → /proc/<pid>/cwd or lsof -d cwd
 │                      project     → nearest package.json / pyproject.toml / go.mod …
 │                      framework   → matched from the command line
 │
 ├─ HTTP probe          GET / with a 0.7 s timeout → status + <title>
 │
 └─ dashboard           http://127.0.0.1:4321, refreshes every 3 s
```

**Who is who:**

| | | | |
|---|---|---|---|
| 🦖 Node.js | 🐍 Python | 🦀 Rust | 🐹 Go |
| 🦕 Deno | 🐰 Bun | 🐞 Ruby | 🐘 PHP · PostgreSQL |
| 🐬 MySQL | 🦊 Redis | 🐳 Docker | 🪐 Jupyter |
| 🦜 Storybook | 🦉 system | 🦝 unknown | |

## 🛡 Safety

The Stop button really does kill processes, so the dashboard is careful:

- It listens on `127.0.0.1` by default.
- It checks the `Host` header, so a website you visit can't reach it through DNS rebinding.
- Stopping requires a random token, created on every start, and a request from the dashboard's own page.
- It only stops processes from the current scan: no arbitrary PIDs, and never itself.
- With `--host` set to anything other than loopback, every request requires the token.

## 🗺 Roadmap

- [x] macOS and Linux
- [x] Project and framework detection, HTTP probe
- [x] CLI: `list`, `kill`, `--json`
- [x] Demo mode
- [ ] Windows (`netstat -ano` + `Get-Process`)
- [ ] Docker container names instead of `docker-proxy`
- [ ] “Open in editor” button
- [ ] Restart button (run the same command in the same folder)
- [ ] Menu-bar / tray app

Adding a framework takes one line in `src/scan.js`.

## 📄 License

[MIT](LICENSE) © koigkio
