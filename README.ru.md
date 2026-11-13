<div align="center">

# 🦝 localhost-zoo

**Все dev-серверы на машине в одной живой панели.**

Узнай, кто занял порт 3000, к какому проекту он относится и не видно ли его из всего интернета. Получи точную команду, которая это исправит. Останови его из браузера, терминала или Telegram.

![Release](https://img.shields.io/github/v/release/koigkio/localhost-zoo?color=2f7d4f)
![Node.js](https://img.shields.io/badge/Node.js-18%2B-5FA04E?logo=node.js&logoColor=white)
![Platforms](https://img.shields.io/badge/платформы-macOS%20%7C%20Linux-lightgrey)
![Dependencies](https://img.shields.io/badge/зависимости-0-brightgreen)
![Telegram](https://img.shields.io/badge/Telegram-бот-26A5E4?logo=telegram&logoColor=white)
![MCP](https://img.shields.io/badge/MCP-сервер-D97757)
![License](https://img.shields.io/badge/license-MIT-blue)

панель · терминал · Telegram-бот · понимает Docker и systemd · проверка «открыт в интернет» с исправлениями · MCP · без зависимостей

[English](README.md)

<img src="assets/demo.gif" alt="localhost-zoo: Redis-контейнер открыт в интернет; How to fix показывает правку docker-compose; один клик его останавливает" width="820">

</div>

---

## ✨ Возможности

- 🔎 **Находит всё, что слушает порты.** Vite, Next.js, Django, Uvicorn, Rails, Jupyter, Postgres, Redis, забытый `python -m http.server`…
- 🌍 **Показывает, что видно из интернета.** Проверяет публичные IP и правила ufw и ловит классическую ловушку: Docker открывает порты в обход ufw.
- 🩹 **Говорит, как починить.** Даёт точную строку под твой стек: `--host 127.0.0.1` для Vite, `bind` для Redis, `127.0.0.1:` в `docker-compose.yml`, правило ufw, SSH-туннель.
- 📱 **Telegram-бот.** Все процессы в кармане, с кнопками Stop. Бот привязан только к твоему аккаунту.
- 🐳 **Знает контейнеры.** Вместо безликого `docker-proxy` видно `shop-db-1 · postgres:16`, а Stop делает `docker stop`.
- ⚙️ **Знает systemd.** Показывает `ml-api.service` и останавливает его через `systemctl`, чтобы он не воскрес через секунду.
- 🔒 **Не даст выстрелить себе в ногу.** sshd и сам Docker не остановить случайным кликом.
- 🖥 **`zoo top`.** Живой вид в стиле htop прямо в терминале.
- 🧹 **Disk zoo.** Находит гигабайты, которые тихо съедает разработка: `node_modules`, виртуальные окружения, `target` от Rust, `.next`, кэши npm/pip/Homebrew/Cargo, DerivedData от Xcode. Выбираешь и отправляешь в Корзину.
- 🤖 **MCP-сервер.** Claude Code, Cursor и другие агенты могут спросить «что на порту 3000?» и освободить его.
- 📁 **Знает, откуда процесс.** Показывает папку, имя проекта из `package.json`, `pyproject.toml`, `go.mod` или `Cargo.toml` и `<title>` страницы.

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
| `zoo telegram` | Telegram-бот (в первый раз спросит токен бота) |
| `zoo list` | dev-серверы таблицей: кто их видит и как починить |
| `zoo kill 3000` | остановить то, что слушает порт 3000: процесс, контейнер или сервис |
| `zoo kill 3000 -f` | то же через SIGKILL / `docker kill` / `systemctl kill` |
| `zoo disk` | папки и кэши, которые можно пересобрать, самые большие сверху |
| `zoo disk clean 1 4` | отправить их в Корзину (номера из `zoo disk`) |
| `zoo disk clean --older 90` | все папки проектов, которые не трогали 90+ дней |
| `zoo mcp` | MCP-сервер для AI-агентов |
| `zoo --json` | сырой результат в JSON, для скриптов |

| Опция | По умолчанию | Что значит |
|---|---|---|
| `-p`, `--port` | `4321` | порт панели |
| `-H`, `--host` | `127.0.0.1` | адрес; любой, кроме loopback, требует токен |
| `--no-open` | | не открывать браузер |
| `--demo` | | демо-данные, работает с любой командой |

## 🧹 Disk zoo

После каждого старого проекта что-то остаётся: гигабайт `node_modules`, `.venv`, `target` от Rust. Менеджеры пакетов хранят кэши вечно. Открой вкладку **Disk** в панели или запусти:

```bash
zoo disk
```

```
 #    SIZE  KIND               IDLE   PATH
 1  6.2 GB  Xcode DerivedData  cache  ~/Library/Developer/Xcode/DerivedData
 2  3.9 GB  Rust build         2d     ~/code/ingest-worker/target
 3  2.1 GB  Rust build         6mo    ~/code/rust-playground/target
 4  1.8 GB  node_modules       8mo    ~/code/old-landing/node_modules
 5  1.4 GB  virtualenv         1.5y   ~/notebooks/kaggle-titanic/.venv

  24.9 GB in 13 folders · 6.3 GB in projects untouched for 90+ days
```

**IDLE** — сколько времени назад ты трогал сам проект. Так забытый хакатон сразу виден на фоне проекта, с которым работаешь каждый день.

- В списке только то, что можно пересобрать: `node_modules`, `.venv` (с `pyvenv.cfg`), `target` рядом с `Cargo.toml`, `.next`, `.nuxt`, `.svelte-kit`, `.turbo`, `.parcel-cache`, `.gradle` и кэши npm, Yarn, pnpm, Bun, pip, Poetry, uv, Homebrew, Cargo, Go, Gradle, Maven и Xcode. Папку `build` или `target` без файла проекта рядом zoo не трогает.
- Всё уходит в **Корзину** (`~/.Trash` на macOS, `~/.local/share/Trash` на Linux), так что можно вернуть. Чтобы место освободилось, очисти Корзину. Shift-клик в панели или `-f` в терминале удаляет насовсем.
- Образы и тома Docker показываются, но чистить их лучше самим `docker system prune`.

## 🚨 Стена позора

Это порты, которые чаще всего забывают открытыми, и то, что обычно происходит дальше. localhost-zoo знает каждый из них по имени.

| Порт | Кто | Что будет, когда его найдёт интернет | Что скажет localhost-zoo |
|---|---|---|---|
| `2375` | Docker API | root на твоём сервере, для любого желающего | 🌍 INTERNET · закрыть TCP-сокет, использовать `ssh://` |
| `6379` | Redis | через пару часов там поселится майнер | 🌍 INTERNET · `bind 127.0.0.1` + `requirepass` |
| `27017` | MongoDB | данные исчезнут, вместо них останется записка с выкупом | 🌍 INTERNET · `bindIp: 127.0.0.1` |
| `9200` | Elasticsearch | твои данные окажутся в отчёте об утечке | 🌍 INTERNET · `network.host: 127.0.0.1` |
| `11211` | Memcached | твой сервер станет участником DDoS | 🌍 INTERNET · `-l 127.0.0.1` |
| `8888` | Jupyter | удалённый шелл с красивым интерфейсом | 🌍 INTERNET · `--ip 127.0.0.1` |
| `5173` | Vite `--host` | `.env` и source maps для всех желающих | 🌍 INTERNET · `--host 127.0.0.1` |
| `8000` | `python -m http.server` | вся папка, включая `.git` | 🌍 INTERNET · `--bind 127.0.0.1` |

> **Ловушка с Docker.** `docker run -p 6379:6379 redis` открывает Redis всему интернету, даже если в `ufw` порт закрыт: Docker пишет свои правила iptables. Это самый частый способ, которым «закрытый файрволом» сервер протекает. Решение — `-p 127.0.0.1:6379:6379`.

## 🩹 Как починить

У каждого открытого dev-сервера есть панель **How to fix** с командами для копирования под его стек:

```
⚠ shop-cache-1 is open to the internet: Docker publishes :6379 past ufw rules
  Redis has no password by default. Exposed instances get taken over for crypto-mining within hours.
  🩹 In ~/code/shop/docker-compose.yml, publish on localhost only:
     services:
       cache:
         ports:
           - "127.0.0.1:6379:6379"
```

Тот же совет показывается в панели, в `zoo top`, в `zoo list`, в Telegram-боте и в MCP-инструменте `check_exposure`.

## 📱 Telegram-бот

<div align="center">
<img src="assets/telegram.png" alt="Telegram-бот: список серверов с предупреждениями INTERNET и карточка сервера с исправлением и кнопками Stop" width="640">
</div>

**Настройка** на сервере:

1. В Telegram открой [@BotFather](https://t.me/BotFather), отправь `/newbot` и придумай имя.
2. Запусти:

   ```bash
   zoo telegram
   ```

3. Вставь токен от BotFather, когда программа попросит. Ввод скрыт, а токен сохраняется в `~/.config/localhost-zoo/telegram.json`, который можешь прочитать только ты.
4. В терминале появится одноразовый код. Отправь боту `/start <код>`. С этого момента бот отвечает **только тебе**.

| В чате | Что делает |
|---|---|
| `/list` | все серверы и кто их видит; нажми на любой, чтобы открыть детали |
| `/exposure` | что видно из интернета и как это исправить |
| `/port 3000` или просто `3000` | кто на порту |
| 🛑 Stop · 💀 Force | остановить после подтверждения; sshd и Docker защищены |

**Чтобы бот работал постоянно**, даже после выхода из SSH:

```bash
zoo telegram service | sudo tee /etc/systemd/system/zoo-bot.service
```

```bash
sudo systemctl enable --now zoo-bot
```

Сменить владельца или токен: `zoo telegram --reset`. В контейнерах и CI токен можно передать через `ZOO_TELEGRAM_TOKEN`.

## 🖥 `zoo top`

```
 🦝 localhost zoo — devbox                         8 dev · 2 system   public IP 203.0.113.7 · ufw active
 ⚠ Open to the internet: ml-api :8000, shop-cache-1 :6379

    PORT          NAME                   KIND         UP    MEM    REACH      WHERE
  🦖 :5173         shop-frontend          Vite         2h    178M   local      ~/code/shop/frontend
  🐍 :8000         ml-api                 Uvicorn      1d    625M   INTERNET   ~/code/ml-api
▸ 🦊 :6379         shop-cache-1           Redis        2d           INTERNET   🐳 redis:7
  🪐 :8888         experiments            Jupyter      3d    225M   firewalled ~/notebooks/experiments
────────────────────────────────────────────────────────────────────────────────────────────────────
 container 3f9a1c2b7d4e · Up 2 days  redis:7  docker-entrypoint.sh redis-server
 internet: Docker publishes :6379 past ufw rules
 🩹 In ~/code/shop/docker-compose.yml, publish on localhost only: services: ⏎ cache: ⏎ ports: ⏎ - "127.0.0.1:6379:6379"
────────────────────────────────────────────────────────────────────────────────────────────────────
 ↑↓ move  s stop  S force  / filter  a show system  r refresh  q quit
```

## 🌍 Кто видит порт?

| Метка | Что значит |
|---|---|
| `local` | слушает `127.0.0.1`: доступен только с этой машины |
| `firewalled` | слушает все интерфейсы, но ufw закрывает его от интернета |
| `network` | доступен из локальной сети: Wi-Fi, офис или сеть провайдера |
| **`INTERNET`** | у сервера публичный IP, и порт ничем не закрыт |

Чтобы читать правила ufw и видеть все процессы, запускай `sudo zoo`.

## 🤖 Для AI-агентов (MCP)

```bash
claude mcp add localhost-zoo -- zoo mcp
```

Для Cursor и других (`mcp.json`):

```json
{ "mcpServers": { "localhost-zoo": { "command": "zoo", "args": ["mcp"] } } }
```

| Инструмент | Что делает |
|---|---|
| `list_servers` | все dev-серверы: порт, проект, фреймворк, папка, заголовок страницы |
| `who_is_on_port` | что именно слушает порт |
| `stop_server` | остановить процесс, контейнер или сервис на порту (помечен как разрушительный, поэтому агент спросит подтверждение) |
| `check_exposure` | что открыто в интернет, почему, чем это грозит и как исправить |

## ⚙️ Как это работает

```
zoo
 │
 ├─ кто слушает порты?    macOS: lsof -iTCP -sTCP:LISTEN · Linux: ss -ltnp
 ├─ контейнеры            docker ps → имена, образы, compose-проекты
 ├─ сервисы               /proc/<pid>/cgroup → nginx.service, ml-api.service …
 ├─ для каждого процесса  ps → команда, время работы, память · cwd → проект
 ├─ кто видит порт        публичные IP + ufw status verbose
 ├─ как починить          советы под стек (адрес привязки, порты compose, ufw, туннель)
 ├─ HTTP-проверка         GET / с таймаутом 0.7 с → статус + <title>
 │
 └─ панель · zoo top · zoo list · Telegram · MCP
```

**Кто есть кто:**

| | | | |
|---|---|---|---|
| 🦖 Node.js | 🐍 Python | 🦀 Rust | 🐹 Go |
| 🦕 Deno | 🐰 Bun | 🐞 Ruby | 🐘 PHP · PostgreSQL |
| 🐬 MySQL | 🦊 Redis | 🐳 Docker | 🪐 Jupyter |
| 🦜 Storybook | 🦌 Elasticsearch | 🦉 системный | 🦝 неизвестный |

## 🛡 Безопасность

- Панель слушает `127.0.0.1` и проверяет заголовок `Host`, поэтому сайт, который ты открыл, до неё не доберётся.
- Для остановки нужен токен, который создаётся при каждом запуске, и остановить можно только то, что есть в текущем скане.
- sshd, Docker и init **защищены**: кнопки Stop у них нет нигде.
- Telegram-бот работает только для одного привязанного владельца, остальные получают «this zoo is private». Перед каждой остановкой бот заново сканирует систему.
- Токен бота хранится только в локальном конфиге (`chmod 600`) и никогда не попадает ни в репозиторий, ни в логи.

## 🦝 FAQ

**Почему енот?** Еноты по ночам роются во всём, что ты оставил без присмотра. Сканеры портов тоже. Лучше, чтобы ты увидел это первым.

**Почему «зоопарк»?** Запусти `zoo` на машине, которая не перезагружалась месяц, и посчитай зверей.

**Он что-то куда-то отправляет?** Нет. Всё работает локально. Единственный сетевой трафик — HTTP-проверка твоих собственных портов и Telegram, если ты включил бота.

**Стена позора не преувеличивает?** К сожалению, нет. Поищи в новостях «exposed Redis» или «MongoDB ransom».

## 🗺 Планы

- [x] macOS и Linux, определение проекта и фреймворка
- [x] Docker-контейнеры по именам · systemd-сервисы
- [x] Проверка доступа из интернета с исправлениями
- [x] `zoo top` · MCP-сервер · Telegram-бот
- [x] Disk zoo: `node_modules`, окружения, сборки и кэши
- [ ] Оповещения в боте: «только что открылся новый порт в интернет»
- [ ] Остановка всего дерева процессов (`npm → node → vite`)
- [ ] firewalld и nftables
- [ ] Windows
- [ ] Публикация в npm

Добавить фреймворк — одна строка в `src/scan.js`.

## 📄 Лицензия

[MIT](LICENSE) © koigkio
