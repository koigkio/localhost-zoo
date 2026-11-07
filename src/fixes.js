// "How do I fix this?" — concrete, copy-pasteable advice for ports that are open
// wider than they should be, plus a plain-words note on what is at risk.

const RISKS = {
  'Redis': 'Redis has no password by default. Exposed instances get taken over for crypto-mining within hours.',
  'MongoDB': 'Open MongoDB databases are routinely wiped and held for ransom.',
  'Elasticsearch': 'Open Elasticsearch clusters are one of the biggest sources of data leaks.',
  'Docker API': 'An open Docker API is root on this machine for anyone who finds it.',
  'Memcached': 'Open Memcached gets abused for massive DDoS amplification.',
  'Jupyter': 'Jupyter runs any code you send it. Exposed, it is a remote shell.',
  'PostgreSQL': 'Databases on the internet get brute-forced around the clock.',
  'MySQL': 'Databases on the internet get brute-forced around the clock.',
  'ClickHouse': 'ClickHouse ships with a passwordless default user.',
  'RabbitMQ': 'Admin panels on the internet get brute-forced constantly (guest/guest is tried first).',
  'Grafana': 'Admin panels on the internet get brute-forced constantly (admin/admin is tried first).',
  'Kibana': 'Kibana gives whoever opens it the data behind it.',
  'Prometheus': 'Prometheus has no auth and leaks hostnames, versions and internal metrics.',
  'MinIO': 'Object storage with default keys leaks every file in every bucket.',
  'Python http.server': 'It serves every file in the folder, including .env and .git.',
  'Django': 'Dev servers are not hardened, and DEBUG pages leak settings and source code.',
  'Flask': 'The Flask debugger runs code from the browser if it is on.',
};
const DEV_SERVER_RISK = 'Dev servers are not hardened: debug pages, source maps and .env files can leak.';
const DEV_SERVERS = new Set(['Vite', 'Next.js', 'Nuxt', 'Astro', 'Remix', 'SvelteKit', 'webpack', 'Create React App',
  'Angular', 'Storybook', 'Expo', 'nodemon', 'NestJS', 'Uvicorn', 'Gunicorn', 'Streamlit', 'Rails', 'Hugo']);

/** How to make a process listen on localhost only, by framework. */
function bindFix(e, port) {
  const f = e.framework;
  const L = '127.0.0.1';
  const map = {
    'Vite': ['Run Vite on localhost (drop --host)', `vite --host ${L} --port ${port}`],
    'Next.js': ['Run Next.js on localhost', `next dev -H ${L} -p ${port}`],
    'Nuxt': ['Run Nuxt on localhost', `nuxi dev --host ${L}`],
    'Astro': ['Run Astro on localhost', `astro dev --host ${L}`],
    'Uvicorn': ['Run Uvicorn on localhost', `uvicorn app:app --host ${L} --port ${port}`],
    'Gunicorn': ['Bind Gunicorn to localhost', `gunicorn -b ${L}:${port} app:app`],
    'Django': ['Run the Django dev server on localhost', `python manage.py runserver ${L}:${port}`],
    'Flask': ['Run Flask on localhost', `flask run --host ${L} --port ${port}`],
    'Python http.server': ['Bind http.server to localhost', `python3 -m http.server ${port} --bind ${L}`],
    'Jupyter': ['Run Jupyter on localhost', `jupyter lab --ip ${L} --port ${port}`],
    'Streamlit': ['Run Streamlit on localhost', `streamlit run app.py --server.address ${L}`],
    'Rails': ['Bind Rails to localhost', `bin/rails server -b ${L} -p ${port}`],
    'Hugo': ['Run Hugo on localhost', `hugo server --bind ${L}`],
    'Redis': ['In redis.conf: listen on localhost and set a password', `bind 127.0.0.1 -::1\nrequirepass <a-long-random-password>`],
    'PostgreSQL': ['In postgresql.conf: listen on localhost', `listen_addresses = 'localhost'`],
    'MySQL': ['In my.cnf: listen on localhost', `bind-address = 127.0.0.1`],
    'MongoDB': ['In /etc/mongod.conf: listen on localhost', `net:\n  bindIp: 127.0.0.1`],
    'Elasticsearch': ['In elasticsearch.yml: listen on localhost', `network.host: 127.0.0.1`],
    'Memcached': ['Start Memcached on localhost', `memcached -l 127.0.0.1 -p ${port}`],
    'Docker API': ['Close the TCP socket and use SSH instead', `# remove "-H tcp://0.0.0.0:${port}" from dockerd, then:\nDOCKER_HOST=ssh://user@server docker ps`],
  };
  const [title, cmd] = map[f] || ['Make it listen on 127.0.0.1 instead of 0.0.0.0', `# look for --host / --bind / listen options in:\n${e.cmdline}`];
  return { title, cmd };
}

/**
 * @returns {{ risk: string|null, fixes: { title: string, cmd: string }[] }}
 */
export function advise(e, net) {
  const level = e.exposure?.level;
  if (!level || level === 'local' || level === 'firewalled' || e.kind !== 'dev') return { risk: null, fixes: [] };

  const openPorts = Object.entries(e.exposure.ports || {})
    .filter(([, l]) => l === level).map(([p]) => Number(p));
  const port = openPorts[0] ?? e.ports[0];
  const fixes = [];

  if (e.container) {
    const b = e.bindings.find((x) => x.port === port) || {};
    const cport = b.containerPort ?? port;
    if (e.project && e.container.service) {
      fixes.push({
        title: `In ${e.cwd ? e.cwd.replace(/^\/(Users|home)\/[^/]+/, '~') + '/' : ''}docker-compose.yml, publish on localhost only`,
        cmd: `services:\n  ${e.container.service}:\n    ports:\n      - "127.0.0.1:${port}:${cport}"`,
      });
    }
    fixes.push({ title: 'With docker run, publish on localhost only', cmd: `docker run -p 127.0.0.1:${port}:${cport} ${e.container.image}` });
    if (level === 'internet' && net?.firewall?.active) {
      fixes.push({ title: 'Why ufw did not help', cmd: '# Docker writes its own iptables rules before ufw sees the packet.\n# Publishing on 127.0.0.1 is the reliable fix.' });
    }
  } else {
    fixes.push(bindFix(e, port));
    if (level === 'internet') {
      if (net?.firewall?.active) fixes.push({ title: 'Or block it in ufw', cmd: `sudo ufw insert 1 deny ${port}/tcp` });
      else if (net?.publicIps?.length) fixes.push({ title: 'Or turn on a firewall (allow SSH first!)', cmd: 'sudo ufw allow OpenSSH && sudo ufw enable' });
    }
  }
  if (level === 'internet') {
    fixes.push({ title: 'Need it from your laptop? Use an SSH tunnel', cmd: `ssh -L ${port}:localhost:${port} user@server` });
  }

  const risk = RISKS[e.framework] || (DEV_SERVERS.has(e.framework) ? DEV_SERVER_RISK : null);
  return { risk: level === 'internet' ? risk : risk && `If someone on your network finds it: ${risk.charAt(0).toLowerCase()}${risk.slice(1)}`, fixes };
}
