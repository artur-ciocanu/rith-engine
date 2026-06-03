---
title: Docker Guide
description: Deploy Rith Engine with Docker for isolated CLI workflow execution.
category: deployment
area: infra
audience: [operator]
status: current
sidebar:
  order: 2
---

Deploy Rith Engine on a server with Docker for isolated CLI workflow execution.


---

## Cloud-Init (Fastest Setup)

The fastest way to deploy. Paste the cloud-init config into your VPS provider's **User Data** field when creating a server — it installs everything automatically.

**File:** `deploy/cloud-init.yml`

### How to use

1. **Create a VPS** (Ubuntu 22.04+ recommended) at DigitalOcean, AWS, Linode, Hetzner, etc.
2. **Paste** the contents of `deploy/cloud-init.yml` into the "User Data" / "Cloud-Init" field
3. **Add your SSH key** via the provider's UI
4. **Create the server** and wait ~5-8 minutes for setup to complete

### What it installs

- Docker + Docker Compose
- UFW firewall (ports 22, 80, 443)
- Clones the repo to `/opt/rith`
- Copies `.env.example` -> `.env` and `Caddyfile.example` -> `Caddyfile`
- Pre-pulls PostgreSQL and Caddy images
- Builds the Rith Engine Docker image

### After boot

SSH into the server and finish configuration:

```bash
# Check setup completed
cat /opt/rith/SETUP_COMPLETE

# Edit credentials and domain
nano /opt/rith/.env

# Set at minimum:
#   DOMAIN=rith.example.com
#   DATABASE_URL=postgresql://postgres:postgres@postgres:5432/remote_coding_agent


# Start
cd /opt/rith
docker compose --profile with-db --profile cloud up -d
```

> **Don't forget DNS**: Before starting, point your domain's A record to the server's IP.

### Provider-specific notes

| Provider | Where to paste cloud-init |
|----------|--------------------------|
| **DigitalOcean** | Create Droplet -> Advanced Options -> User Data |
| **AWS EC2** | Launch Instance -> Advanced Details -> User Data |
| **Linode** | Create Linode -> Add Tags -> Metadata (User Data) |
| **Hetzner** | Create Server -> Cloud config -> User Data |
| **Vultr** | Deploy -> Additional Features -> Cloud-Init User-Data |

---

## Local Docker Desktop (Windows / macOS)

Run Rith Engine locally with Docker Desktop — no domain, no VPS required. Uses SQLite for local development.

### Quick start

```bash
git clone https://github.com/artur-ciocanu/rith-engine.git
cd Rith Engine
cp .env.example .env
# Edit .env: set GH_TOKEN and GITHUB_TOKEN
docker compose up -d
```


### Windows-specific notes

**Build from WSL, not PowerShell.** Docker Desktop on Windows cannot follow Bun workspace symlinks during the build context transfer. If you see `The file cannot be accessed by the system`, open a WSL terminal:

```bash
cd /mnt/c/Users/YourName/path/to/Rith Engine
docker compose up -d
```

**Line endings:** The repo uses `.gitattributes` to force LF endings for shell scripts. If you cloned before this was added and see `exec docker-entrypoint.sh: no such file or directory`, re-clone or run:

```bash
git rm --cached -r .
git reset --hard
```

### What you get

| Feature | Status |
|---------|--------|
| Database | SQLite (automatic, zero setup) |
| HTTPS / Caddy | Not needed locally |
| Auth | None (single-user, localhost only) |

### Using PostgreSQL locally (optional)

```bash
docker compose --profile with-db up -d
```

Then add to `.env`:
```env
DATABASE_URL=postgresql://postgres:postgres@postgres:5432/remote_coding_agent
```

---

## Manual Server Setup

Step-by-step alternative if you prefer not to use cloud-init, or need more control.

### 1. Install Docker

```bash
# On Ubuntu/Debian
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER

# Log out and back in for group change to take effect
exit
# ssh back in

# Verify
docker --version
docker compose version
```

### 2. Clone the repo

```bash
git clone https://github.com/artur-ciocanu/rith-engine.git
cd Rith Engine
```

### 3. Configure environment

```bash
cp .env.example .env
cp Caddyfile.example Caddyfile
nano .env
```

Set these values in `.env`:

```ini
# Domain — your domain or subdomain pointing to this server
DOMAIN=rith.example.com

# Database — connect to the Docker PostgreSQL container
# Without this, the app uses SQLite (fine for getting started, but PostgreSQL recommended)
DATABASE_URL=postgresql://postgres:postgres@postgres:5432/remote_coding_agent

# GitHub tokens (set the ones you use)
# GH_TOKEN=ghp_...
# GITHUB_TOKEN=ghp_...
```

> **AI credentials:** After starting the container, authenticate Pi Coding Agent with `docker compose exec app pi /login`.
>
> **If you use `--profile with-db` without setting `DATABASE_URL`**, the app will fall back to SQLite and log a warning. The PostgreSQL container runs but is unused.

### 4. Point your domain to the server

Create a DNS **A record** at your domain registrar:

| Type | Name | Value |
|------|------|-------|
| A | `rith` (or `@` for root domain) | Your server's public IP |

Wait for DNS propagation (usually 5-60 minutes). Verify with `dig rith.example.com`.

### 5. Open firewall ports

```bash
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443
sudo ufw --force enable
```

### 6. Start

```bash
docker compose --profile with-db --profile cloud up -d
```

This starts three containers:
- **app** — Rith Engine CLI runtime
- **postgres** — PostgreSQL 17 database (auto-initialized)
- **caddy** — Reverse proxy with automatic HTTPS (Let's Encrypt)

### 7. Verify

```bash
# Check all containers are running
docker compose --profile with-db --profile cloud ps

# Watch logs
docker compose logs -f app
docker compose logs -f caddy

# Test HTTPS (from your local machine)
curl https://rith.example.com/api/health
```


---

## Profiles

Rith Engine uses Docker Compose profiles to optionally add PostgreSQL and/or HTTPS. Mix and match:

| Command | What runs |
|---------|-----------|
| `docker compose up -d` | App with SQLite |
| `docker compose --profile with-db up -d` | App + PostgreSQL |
| `docker compose --profile cloud up -d` | App + Caddy (HTTPS) |
| `docker compose --profile with-db --profile cloud up -d` | App + PostgreSQL + Caddy |

:::note
There is no `external-db` profile. When using an external PostgreSQL database (Supabase, Neon, etc.), just set `DATABASE_URL` in `.env` and run `docker compose up -d` without any profile. The base `app` service always starts.
:::

### No profile (SQLite)

Zero-config default. No database container needed — SQLite file is stored in the `rith_data` volume.

### `--profile with-db` (PostgreSQL)

Starts a PostgreSQL 17 container. Set the connection URL in `.env`:

```ini
DATABASE_URL=postgresql://postgres:postgres@postgres:5432/remote_coding_agent
```

The schema is auto-initialized on first startup. PostgreSQL is exposed on `${POSTGRES_PORT:-5432}` for external tools.

### `--profile cloud` (Caddy HTTPS)

Adds a [Caddy](https://caddyserver.com/) reverse proxy with automatic TLS certificates from Let's Encrypt.

**Requires before starting:**

1. `Caddyfile` created: `cp Caddyfile.example Caddyfile`
2. `DOMAIN` set in `.env`
3. DNS A record pointing to your server's IP
4. Ports 80 and 443 open

Caddy handles HTTPS certificates, HTTP->HTTPS redirect, and HTTP/3.

### Authentication (Optional Basic Auth)

Caddy can enforce HTTP Basic Auth on all routes except webhooks (`/webhooks/*`) and the health check (`/api/health`). This is optional — skip it if you use IP-based firewall rules or other network-level access control.

**To enable:**

1. Generate a bcrypt password hash:

   ```bash
   docker run caddy caddy hash-password --plaintext 'YOUR_PASSWORD'
   ```

2. Set `CADDY_BASIC_AUTH` in `.env` (use `$$` to escape `$` in bcrypt hashes):

   ```ini
   CADDY_BASIC_AUTH=basicauth @protected { admin $$2a$$14$$abc123... }
   ```

3. Restart: `docker compose --profile cloud restart caddy`

Your browser will prompt for username/password when accessing the Rith Engine URL. Webhook endpoints bypass auth since they use HMAC signature verification.

To disable, leave `CADDY_BASIC_AUTH` empty or unset — the Caddyfile expands it to nothing.

> **Important:** Always use the `docker run caddy caddy hash-password` command to generate hashes — never put plaintext passwords in `.env`.

### Form-Based Authentication (HTML Login Page)

An alternative to basic auth that serves a styled HTML login form instead of the browser's credential popup. Uses a lightweight `auth-service` sidecar and Caddy's `forward_auth` directive.

**When to use form auth vs basic auth:**
- **Form auth**: Styled dark-mode login page, 24h session cookie, logout support. Requires an extra container.
- **Basic auth**: Zero extra containers, simpler setup. Browser shows a native credential dialog.

**Setup:**

1. Generate a bcrypt password hash:

   ```bash
   docker compose --profile auth run --rm auth-service \
     node -e "require('bcryptjs').hash('YOUR_PASSWORD', 12).then(h => console.log(h))"
   ```

   > First run builds the auth-service image. Save the output hash (starts with `$2b$12$...`).

2. Generate a random cookie signing secret:

   ```bash
   docker run --rm node:22-alpine \
     node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

3. Set the following in `.env`:

   ```ini
   AUTH_USERNAME=admin
   AUTH_PASSWORD_HASH=$2b$12$REPLACE_WITH_YOUR_HASH
   COOKIE_SECRET=REPLACE_WITH_64_HEX_CHARS
   ```

4. Update `Caddyfile` (copy from `Caddyfile.example` if not done yet):

   - **Uncomment** the "Option A" form auth block (the `handle /login`, `handle /logout`, and `handle { forward_auth ... }` blocks)
   - **Comment out** the "No auth" default `handle` block (the last `handle { ... }` block near the bottom of the site block)

5. Start with both `cloud` and `auth` profiles:

   ```bash
   docker compose --profile with-db --profile cloud --profile auth up -d
   ```

6. Visit your domain — you should be redirected to `/login`.

**Logout:** Navigate to `/logout` to clear the session cookie and return to the login form.

**Session duration:** Defaults to 24 hours (`COOKIE_MAX_AGE=86400`). Override in `.env`:
```ini
COOKIE_MAX_AGE=3600  # 1 hour
```

> **Note:** Do not use form auth and basic auth simultaneously. Choose one method and leave the other disabled (either empty `CADDY_BASIC_AUTH` or remove the basic auth `@protected` block from your Caddyfile).

---

## Configuration

### Port Defaults

:::caution
Docker defaults to port **3000** (`${PORT:-3000}` in docker-compose.yml), while local development defaults to **3090**. Set `PORT` in `.env` to change the Docker port.
:::

The Docker healthcheck uses `/api/health` (not `/health`):

```bash
# Inside Docker
curl http://localhost:3000/api/health

# Local development (both work)
curl http://localhost:3090/health
curl http://localhost:3090/api/health
```

### AI Credentials (required)

Pi Coding Agent is the LLM executor. Authenticate interactively after starting the container:

```bash
docker compose exec app pi /login
```

Credentials are persisted in the `rith_user_home` volume at `~/.pi/agent/auth.json`.

### GitHub Tokens (optional)

```ini
GH_TOKEN=ghp_...
GITHUB_TOKEN=ghp_...
WEBHOOK_SECRET=...
```

### Server Settings (optional)

```ini
PORT=3000                          # Default: 3000
DOMAIN=rith.example.com          # Required for --profile cloud
LOG_LEVEL=info                     # fatal|error|warn|info|debug|trace
MAX_CONCURRENT_CONVERSATIONS=10
```

See `.env.example` for the full list with documentation.

### Data Directory

The container stores all data at `/.rith/` (workspaces, worktrees, artifacts, logs, SQLite DB).

By default this is a Docker-managed volume. To store data at a specific location on the host, set `RITH_DATA` in `.env`:

```ini
# Store Rith Engine data at a specific host path
RITH_DATA=/opt/rith-data
```

:::note
`RITH_HOME` from `.env.example` is **ignored inside Docker** — the container always uses `/.rith`. Use `RITH_DATA` (host-side bind-mount source) to control *where on the host* `/.rith` lives. Both `RITH_HOME` and `RITH_DATA` leak into the container env via `env_file: .env`, which is harmless but expected.
:::

The directory is created automatically. Make sure the path is writable by UID 1001 (the container user):

```bash
mkdir -p /opt/rith-data
sudo chown -R 1001:1001 /opt/rith-data
```

If `RITH_DATA` is not set, Docker manages the volume automatically (`rith_data`) — data persists across restarts and rebuilds but lives inside Docker's storage.

### User Home Directory (Persisted)

The container runs as `appuser` with `$HOME=/home/appuser`. The base compose mounts `/home/appuser` as a named volume (`rith_user_home`) by default, so user-specific state survives container rebuilds without any operator action:

| Path | What it persists |
|------|------------------|
| `~/.pi/agent/` | Pi `auth.json` from interactive `pi /login`, plus `models.json`, global settings (`~/.pi/agent/settings.json`), and sessions (Rith Engine's Pi adapter reads `auth.json` and `settings.json` on every request) |
| `~/.gitconfig` | Author identity, signing config, custom aliases, plus the `safe.directory` entries baked into the image |
| `~/.bash_history` | Shell history when you `docker compose exec app bash` |
| `~/.config/gh/` | GitHub CLI auth from interactive `gh auth login` (the `GH_TOKEN` env-var path works without it) |

To bind-mount a host path instead of the default named volume, set `RITH_USER_HOME` in `.env`:

```ini
RITH_USER_HOME=/opt/rith-user-home
```

The host path must be writable by UID 1001 — chown it once before first start:

```bash
mkdir -p /opt/rith-user-home
sudo chown -R 1001:1001 /opt/rith-user-home
```

The entrypoint re-applies ownership on every container start, so subsequent rebuilds work without re-running `chown`.

:::caution
Bind-mount paths do **not** inherit the image's baked `~/.gitconfig` (Docker only copies image content into named volumes on first creation, never into bind mounts). The entrypoint still registers git `safe.directory` entries for `/.rith/workspaces` and `/.rith/worktrees` repos at runtime, so functionality is preserved — but a bind-mounted `~/.gitconfig` starts empty and any author identity / signing config you want must be set explicitly with `git config --global` inside the container.
:::

If `RITH_USER_HOME` is not set, Docker manages the volume automatically (`rith_user_home`) — config persists across restarts and rebuilds but lives inside Docker's storage. To wipe it: `docker compose down && docker volume rm rith_rith_user_home`.

#### Relocating Pi data to the RITH_DATA volume (optional)

By default Pi's data directory (`~/.pi/agent/`) is persisted via the `rith_user_home` volume above. If you'd rather keep Pi data alongside the rest of `/.rith/` (e.g. to back it up with the same volume), set `PI_CODING_AGENT_DIR` in `.env` to redirect it:

```ini
# Optional — only needed if you want Pi data on the RITH_DATA volume instead
PI_CODING_AGENT_DIR=/.rith/pi
```

This must be set before the container starts; the Pi SDK reads the variable on each file path lookup.

### GitHub CLI Authentication

`GH_TOKEN` from `.env` is picked up automatically. Alternatively:

```bash
docker compose exec app gh auth login
```

---

## GitHub Webhooks

After the server is reachable via HTTPS:

1. Go to `https://github.com/<owner>/<repo>/settings/hooks`
2. Add webhook:
   - **Payload URL**: `https://rith.example.com/webhooks/github`
   - **Content type**: `application/json`
   - **Secret**: Your `WEBHOOK_SECRET` from `.env`
   - **Events**: Issues, Issue comments, Pull requests

---

## Pre-built Image

For users who don't need to build from source:

```bash
mkdir rith && cd rith
curl -O https://raw.githubusercontent.com/artur-ciocanu/rith-engine/main/deploy/docker-compose.yml
curl -O https://raw.githubusercontent.com/artur-ciocanu/rith-engine/main/.env.example

cp .env.example .env
# Edit .env — set AI credentials, DOMAIN, etc.

docker compose up -d
```

Uses `ghcr.io/artur-ciocanu/rith-engine:latest`. To add PostgreSQL, uncomment the `postgres` service in the compose file and set `DATABASE_URL` in `.env`.

To layer custom tools on top of the pre-built image, see [Customizing the Image](#customizing-the-image).

---

## Building the Image

The Dockerfile uses three stages:

1. **deps** — Installs all dependencies
2. **build** — Builds the application
3. **production** — Production image with only production dependencies

```bash
docker build -t rith .
docker run --env-file .env -p 3000:3000 rith
```

**What's in the image:**

- **Runtime**: Bun 1.2 (runs TypeScript directly, no compile step)
- **System deps**: git, curl, gh (GitHub CLI), postgresql-client, Chromium
- **Browser tooling**: [agent-browser](https://github.com/vercel-labs/agent-browser) (Vercel Labs) — enables E2E testing workflows via CDP. Uses system Chromium (`AGENT_BROWSER_EXECUTABLE_PATH=/usr/bin/chromium`)
- **App**: All workspace packages (source)
- **User**: Non-root `appuser` (UID 1001)
- **Rith Engine dirs**: `/.rith/workspaces`, `/.rith/worktrees`

The multi-stage build keeps the image lean — no devDependencies, test files, docs, or `.git/`.

### Customizing the Image

To add extra tools without modifying the tracked Dockerfile:

1. Copy the example:
   - **Local/dev**: `cp Dockerfile.user.example Dockerfile.user`
   - **Server/deploy**: `cp deploy/Dockerfile.user.example Dockerfile.user`
2. Edit `Dockerfile.user` — uncomment and extend the examples as needed.
3. Copy the override file:
   - **Local/dev**: `cp docker-compose.override.example.yml docker-compose.override.yml`
   - **Server/deploy**: `cp deploy/docker-compose.override.example.yml docker-compose.override.yml`
4. Run `docker compose up -d` — Compose merges the override automatically.

`Dockerfile.user` and `docker-compose.override.yml` are gitignored so your customizations stay local.

---

## Maintenance

### View Logs

```bash
docker compose logs -f              # All services
docker compose logs -f app          # App only
docker compose logs --tail=100 app  # Last 100 lines
```

### Update

```bash
git pull
docker compose --profile with-db --profile cloud up -d --build
```

### Restart

```bash
docker compose restart         # All
docker compose restart app     # App only
```

### Stop

```bash
docker compose down            # Stop containers (data preserved)
docker compose down -v         # Stop + delete volumes (destructive!)
```

### Database Migrations (PostgreSQL)

Migrations run automatically on first startup via `000_combined.sql`. When upgrading to a newer version that adds database tables, you need to apply incremental migrations manually:

```bash
# Example: apply the env vars migration (required when upgrading to v0.3.x)
docker compose exec postgres psql -U postgres -d remote_coding_agent -f /migrations/020_codebase_env_vars.sql
```

The `migrations/` directory is mounted read-only into the postgres container. Check for any new migration files after pulling updates.

### Clean Up Docker Resources

```bash
docker system prune -a         # Remove unused images/containers
docker volume prune            # Remove unused volumes (caution!)
docker system df               # Check disk usage
```

---

## Troubleshooting

### App won't start: "no_ai_credentials"

No AI assistant configured. Run `docker compose exec app pi /login` to authenticate Pi Coding Agent.

### Caddy fails to start: "not a directory"

```
error mounting "Caddyfile": not a directory
```

The `Caddyfile` doesn't exist — Docker created a directory in its place. Fix:

```bash
rm -rf Caddyfile
cp Caddyfile.example Caddyfile
docker compose --profile cloud up -d
```

### Caddy not getting SSL certificate

```bash
# Check DNS propagation
dig rith.example.com
# Should return your server IP

# Check Caddy logs
docker compose logs caddy

# Check firewall
sudo ufw status
# Ports 80 and 443 must be open
```

Common causes: DNS not propagated (wait 5-60min), firewall blocking 80/443, domain typo in `.env`.

### Health check failing

The Docker healthcheck uses `/api/health` (not `/health`):

```bash
curl http://localhost:3000/api/health
```

### PostgreSQL connection refused

When using `--profile with-db`, ensure:

1. `DATABASE_URL` uses `postgres` as hostname (Docker service name), not `localhost`:
   ```ini
   DATABASE_URL=postgresql://postgres:postgres@postgres:5432/remote_coding_agent
   ```
2. The postgres container is healthy: `docker compose ps postgres`
3. Migrations ran: check `docker compose logs postgres` for init script output

### Permission errors in `/.rith/`

The container runs as `appuser` (UID 1001). If using bind mounts instead of Docker volumes:

```bash
sudo chown -R 1001:1001 /path/to/rith-data
```

### Port conflicts

Default Docker port is 3000 (local dev is 3090). Change in `.env`:

```ini
PORT=3001
```

### Container keeps restarting

```bash
docker compose ps
docker compose logs --tail=50 app
```

Common causes: missing `.env` file, invalid credentials, database unreachable.
