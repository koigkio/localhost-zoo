<div align="center">

# 🦝 localhost-zoo

**Все dev-серверы на машине в одной живой панели.**

Узнай, кто занял порт 3000, к какому проекту он относится и не видно ли его из всего интернета. И останови его в один клик.

![Release](https://img.shields.io/github/v/release/koigkio/localhost-zoo?color=2f7d4f)
![Node.js](https://img.shields.io/badge/Node.js-18%2B-5FA04E?logo=node.js&logoColor=white)
![Platforms](https://img.shields.io/badge/платформы-macOS%20%7C%20Linux-lightgrey)
![Dependencies](https://img.shields.io/badge/зависимости-0-brightgreen)
![MCP](https://img.shields.io/badge/MCP-сервер-D97757)
![License](https://img.shields.io/badge/license-MIT-blue)

панель · интерфейс в терминале · понимает Docker · проверка доступа из интернета · MCP для AI-агентов · без зависимостей

[English](README.md)

<img src="assets/demo.gif" alt="localhost-zoo: Redis-контейнер помечен как открытый в интернет, один клик его останавливает, и предупреждение исчезает" width="820">

</div>

---

## ✨ Возможности

- 🔎 **Находит всё, что слушает порты.** Vite, Next.js, Django, Rails, Uvicorn, Jupyter, Postgres, Redis, забытый `python -m http.server`…
- 🐳 **Знает контейнеры.** Вместо безликого `docker-proxy` видно `shop-db-1 · postgres:16` и compose-проект. Stop делает `docker stop`.
- 🌍 **Показывает, что видно из интернета.** Проверяет публичные IP и правила ufw и ловит классическую ловушку: Docker открывает порты в обход ufw.
- 🖥 **`zoo top`.** Живой вид в стиле htop прямо в терминале. Сделан для работы по SSH.
- 🤖 **MCP-сервер.** Claude Code, Cursor и другие агенты могут спросить «что на порту 3000?» и освободить его.
- 📁 **Знает, откуда процесс.** Показывает папку, имя проекта из `package.json`, `pyproject.toml`, `go.mod` или `Cargo.toml` и фреймворк.
- 🌐 **Заглядывает на страницу.** HTTP-статус и `<title>`: вместо «:5173» видно «Shop — dev».
- 🛑 **Останавливает процессы.** Два клика по Stop — SIGTERM, Shift+клик — SIGKILL.
- 🦉 **Прячет лишнее.** Системные процессы не мешают, пока не попросишь.

## 🚀 Установка

```bash
npm install -g github:koigkio/localhost-zoo
```

Запуск:

```bash
zoo
```

Панель откроется на http://localhost:4321.

**Нужен** Node.js 18 или новее.

| Система | Что сделать |
|---|---|
| macOS | `brew install node` или скачать с [nodejs.org](https://nodejs.org) |
| Ubuntu / Debian | `curl -fsSL https://deb.nodesource.com/setup_22.x \| sudo -E bash - && sudo apt-get install -y nodejs` |
| Другой Linux | [nodejs.org/en/download](https://nodejs.org/en/download) |

Хочешь просто посмотреть? Добавь `--demo` к любой команде: будут выдуманные серверы, и ничего по-настоящему не остановится.

## 🎛 Команды

| Команда | Что делает |
|---|---|
| `zoo` | открыть панель |
| `zoo top` | живой вид в терминале |
| `zoo list` | dev-серверы таблицей и кто их видит |
| `zoo list --all` | то же, вместе с системными процессами |
| `zoo kill 3000` | остановить то, что слушает порт 3000: процесс или контейнер |
| `zoo kill 3000 -f` | то же, через SIGKILL / `docker kill` |
| `zoo mcp` | MCP-сервер для AI-агентов |
| `zoo --json` | сырой результат в JSON, для скриптов |

| Опция | По умолчанию | Что значит |
|---|---|---|
| `-p`, `--port` | `4321` | порт панели |
| `-H`, `--host` | `127.0.0.1` | адрес; любой, кроме loopback, требует токен |
| `--no-open` | | не открывать браузер |
| `--demo` | | демо-данные, работает с любой командой |

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

| Клавиша | Действие |
|---|---|
| `↑` `↓` или `j` `k` | перемещение |
| `s` · `S` | остановить · принудительно (с подтверждением) |
| `/` | фильтр по порту, имени, образу… |
| `a` | показать или скрыть системные процессы |
| `r` · `q` | обновить · выйти |

## 🌍 Кто видит порт?

Каждый порт получает одну из четырёх меток:

| Метка | Что значит |
|---|---|
| `local` | слушает `127.0.0.1`: доступен только с этой машины |
| `firewalled` | слушает все интерфейсы, но ufw закрывает его от интернета |
| `network` | доступен из локальной сети: Wi-Fi, офис или сеть провайдера |
| **`INTERNET`** | у сервера публичный IP, и порт ничем не закрыт |

**Ловушка с Docker.** `docker run -p 6379:6379 redis` открывает Redis всему интернету, даже если в `ufw` порт закрыт: Docker пишет свои правила iptables. localhost-zoo помечает это красным. Решение — публиковать порт только на localhost: `-p 127.0.0.1:6379:6379`.

Чтобы читать правила ufw и видеть все процессы, запускай `sudo zoo`.

## 🤖 Для AI-агентов (MCP)

`zoo mcp` — это сервер [Model Context Protocol](https://modelcontextprotocol.io). С ним агент сам проверит порт перед запуском dev-сервера и освободит его, не заставляя тебя копаться в `lsof`.

**Claude Code:**

```bash
claude mcp add localhost-zoo -- zoo mcp
```

**Cursor и другие** (`mcp.json`):

```json
{ "mcpServers": { "localhost-zoo": { "command": "zoo", "args": ["mcp"] } } }
```

| Инструмент | Что делает |
|---|---|
| `list_servers` | все dev-серверы: порт, проект, фреймворк, папка, заголовок страницы |
| `who_is_on_port` | что именно слушает порт |
| `stop_server` | остановить процесс или контейнер на порту (помечен как разрушительный, поэтому агент спросит подтверждение) |
| `check_exposure` | какие порты видны из интернета или сети и почему |

## 🌐 На удалённом сервере

Проще всего прямо на сервере запустить `zoo top`.

Веб-панель открывай через SSH-туннель со своего ноутбука:

```bash
ssh -L 4321:localhost:4321 root@your-server 'zoo --no-open'
```

Потом открой http://localhost:4321 у себя.

<details>
<summary><b>Открыть без туннеля</b></summary>

```bash
zoo --host 0.0.0.0
```

Программа напечатает ссылку вида `http://<ip-сервера>:4321/?t=<токен>`. Без токена панель не откроется.

Учти: трафик идёт по обычному HTTP, а панель может остановить любой процесс, доступный пользователю. Тот, кто увидит ссылку, сможет так же. Подходит для быстрого взгляда, не для постоянной работы.

</details>

## ⚙️ Как это работает

```
zoo
 │
 ├─ кто слушает порты?    macOS: lsof -iTCP -sTCP:LISTEN
 │                        Linux: ss -ltnp   (если нет — lsof)
 │
 ├─ контейнеры            docker ps → имена, образы, compose-проекты
 │
 ├─ для каждого процесса  ps        → команда, время работы, память
 │                        cwd       → /proc/<pid>/cwd или lsof -d cwd
 │                        проект    → ближайший package.json / pyproject.toml / go.mod …
 │
 ├─ кто видит порт        публичные IP на интерфейсах + ufw status verbose
 │
 ├─ HTTP-проверка         GET / с таймаутом 0.7 с → статус + <title>
 │
 └─ панель · zoo top · zoo list · zoo mcp
```

**Кто есть кто:**

| | | | |
|---|---|---|---|
| 🦖 Node.js | 🐍 Python | 🦀 Rust | 🐹 Go |
| 🦕 Deno | 🐰 Bun | 🐞 Ruby | 🐘 PHP · PostgreSQL |
| 🐬 MySQL | 🦊 Redis | 🐳 Docker | 🪐 Jupyter |
| 🦜 Storybook | 🦉 системный | 🦝 неизвестный | |

## 🛡 Безопасность

Stop действительно убивает процессы и контейнеры, поэтому панель осторожна:

- По умолчанию слушает только `127.0.0.1`.
- Проверяет заголовок `Host`, поэтому сайт, который ты открыл, не доберётся до неё через DNS rebinding.
- Для остановки нужен случайный токен, который создаётся при каждом запуске, и запрос со страницы самой панели.
- Останавливает только то, что есть в текущем скане: никаких произвольных PID и никогда саму себя.
- Если `--host` не loopback, токен нужен для любого запроса.

## 🗺 Планы

- [x] macOS и Linux
- [x] Определение проекта и фреймворка, HTTP-проверка
- [x] CLI: `list`, `kill`, `--json`, демо-режим
- [x] Docker-контейнеры по именам, `docker stop`
- [x] Проверка доступа из интернета (публичный IP, ufw, Docker в обход ufw)
- [x] Интерфейс в терминале `zoo top`
- [x] MCP-сервер для AI-агентов
- [ ] Остановка всего дерева процессов (`npm → node → vite`)
- [ ] firewalld и nftables
- [ ] Windows (`netstat -ano` + `Get-Process`)
- [ ] Кнопки «открыть в редакторе» и «перезапустить»
- [ ] Публикация в npm

Добавить фреймворк — одна строка в `src/scan.js`.

## 📄 Лицензия

[MIT](LICENSE) © koigkio
