# DEPLOY — putting Cipher on the mini PC

This is `messaging-plan.md` stage 8, written as a runbook. It assumes the
Ubuntu mini PC, a domain on Cloudflare, and a Cloudflare Tunnel for ingress —
the decisions locked in that plan.

**Read the order literally.** Mail and DNS are set up *before* the first deploy
on purpose: verification is required before login, so a box whose mail does not
send is a box nobody can create an account on, including you. That failure
looks like a signup that quietly never completes.

The domain is **`findiepman.dev`** and the app lives at
**`cipher.findiepman.dev`**. Both are filled in below, so the commands are
copy-pasteable as written.

One thing `.dev` implies: it is on the HSTS preload list, so browsers refuse
plain HTTP to it entirely. That is fine here — Cloudflare serves HTTPS at the
edge — but it does mean there is no http:// fallback to test with if something
looks wrong.

---

## The shape of it

```
                    ┌─────────────────── the mini PC ──────────────────┐
  browser           │                                                  │
    │               │  cloudflared ──▶ web (Caddy) ──┬──▶ server        │
    ▼               │   outbound       static SPA    │    Fastify       │
 Cloudflare ────────┼──▶ tunnel        + proxy       │      │           │
    edge            │                                │      ▼           │
                    │                                │   postgres       │
                    └──────────────────────────────────────────────────┘
                                                     │
                                  Resend ◀───────────┘  (SMTP, outbound)
```

Four containers, **no published ports and no inbound firewall rule**.
`cloudflared` dials out to Cloudflare and the tunnel carries requests back, so
the box needs no static IP, no port forwarding, and works behind CGNAT.
Postgres is reachable only from the other containers.

### It does not take port 80, or any host port

Worth stating outright if the box already runs other services. Nothing in
`docker-compose.prod.yml` has a `ports:` mapping. The `:80` in
`deploy/Caddyfile` is inside the web container's own network namespace, and
`cloudflared` reaches it as `web:80` over the private `cipher_default` Docker
network. The host's port 80 is never bound, and neither is 443, 3000 or 5432 —
so an existing reverse proxy, or a Postgres already running on the host, is
untouched.

Everything is namespaced under the compose project `cipher`: containers are
`cipher-web-1` and friends, the network is `cipher_default`, the volume is
`cipher_pgdata`. No fixed `container_name` anywhere, so nothing can collide
with a container you already have.

**Do not run `server/docker-compose.yml` on the box.** That one is the
development stack — it publishes 5432, 1025 and 8025 and uses fixed container
names, so it *would* collide. It exists for a laptop with nothing else running.

The one case where a host port would matter is reaching the app over the LAN
without going through Cloudflare. That needs an explicit mapping on a port you
know is free, added to the `web` service:

```yaml
    ports:
      - "8080:80"     # pick anything free; 80 is not required
```

One hostname serves everything: Caddy serves the built client at `/` and
proxies the API prefixes and `/socket.io` to Fastify. That is not tidiness.
Same-origin is what keeps the auth cookies first-party and makes `SameSite=Lax`
an actual defence, which matters because CSRF tokens are still unbuilt
(`backend-plan.md` step 6).

---

## What you need before you start

- The domain, with its nameservers already pointed at Cloudflare.
- The mini PC on Ubuntu, reachable over SSH.
- A Resend account — the free tier covers this comfortably.
- A Cloudflare Zero Trust account — free, created on first use.

---

## Step 1 — Mail (first, because DNS takes time to propagate)

### 1.1 Add and verify the domain in Resend

1. Resend → **Domains** → **Add Domain** → enter `findiepman.dev`.
2. Resend shows a set of DNS records. **Copy them from that screen**, not from
   any documentation including this file — the SES region in the MX host
   differs per account and a wrong one fails silently. They will look like
   this:

   | Type | Name | Value |
   |---|---|---|
   | MX | `send` | `feedback-smtp.<region>.amazonses.com`, priority 10 |
   | TXT | `send` | `v=spf1 include:amazonses.com ~all` |
   | TXT | `resend._domainkey` | `p=MIGfMA0GCSq...` — a long DKIM key |

3. In Cloudflare → **DNS** → **Records**, add each one exactly. MX and TXT
   records are never proxied, so there is no orange cloud to think about.

4. Add a DMARC record as well. Resend does not require one, but receivers treat
   a brand-new sending domain without it with suspicion:

   | Type | Name | Value |
   |---|---|---|
   | TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:fin@findiepman.dev` |

   `p=none` means "monitor, do not act". Tighten it to `quarantine` later, once
   you have seen a few reports and know nothing legitimate is failing.

5. Back in Resend, click **Verify**. Through Cloudflare it is usually a minute
   or two. Do not continue until every record shows verified.

### 1.2 Create the API key

Resend → **API Keys** → **Create API Key**, permission **Sending access**. Copy
it now; it is shown once. That key is `SMTP_PASSWORD`. The SMTP *username* is
the literal string `resend`.

### 1.3 Prove it works before anything depends on it

From your dev machine. Set these five lines in `server/.env` — and **leave
`MAIL_TRANSPORT=file` alone**, because both smoke scripts need it and this
script does not consult it:

```ini
SMTP_HOST=smtp.resend.com
SMTP_PORT=587
SMTP_USER=resend
SMTP_PASSWORD=re_your_key_here
MAIL_FROM="Cipher <no-reply@findiepman.dev>"
```

```bash
cd server
npm run mail:test -- you@yourrealaddress.com
```

That connects, authenticates, and sends a real message — and it tells you which
of the two failed. The common failure is the second: providers reject a `From`
address on a domain that is not verified, and that only ever surfaces at send
time.

```bash
npm run mail:test -- --preview   # renders both emails to .mail/, sends nothing
```

#### If it lands in spam

Expected on a first send, and usually not what it looks like. Work through it
in this order:

1. **Was `APP_URL` still `http://localhost:5173`?** Then the mail contained a
   localhost call-to-action link and an `<img>` the receiver could not resolve,
   over plain http — close to the textbook shape of a phishing mail. It was
   filtered on content, and that says nothing about the domain. Re-test with
   the real host before concluding anything:

   ```bash
   APP_URL=https://cipher.findiepman.dev npm run mail:test -- you@example.com
   ```

   The script warns about this now, but the warning is easy to scroll past.

2. **Check the records actually resolve**, rather than trusting the Resend
   dashboard's cached view:

   ```bash
   nslookup -type=TXT _dmarc.findiepman.dev 8.8.8.8
   nslookup -type=TXT send.findiepman.dev 8.8.8.8
   nslookup -type=TXT resend._domainkey.findiepman.dev 8.8.8.8
   nslookup -type=MX  send.findiepman.dev 8.8.8.8
   ```

   You want SPF (`v=spf1 include:amazonses.com ~all`), a DKIM key, a DMARC
   record, and the SES feedback MX.

3. **Open the received mail's headers** and confirm `dkim=pass`, `spf=pass`,
   `dmarc=pass`. If all three pass, authentication is not the problem —
   reputation is, and reputation is a matter of time and engagement rather than
   configuration.

4. **Mark it "not spam"** in your own client. That is the only lever you have
   on a domain with no sending history, and it compounds.

Once you have seen a few DMARC reports and know nothing legitimate is failing,
tighten `_dmarc` from `p=none` to `p=quarantine`.

---

## Step 2 — The Cloudflare Tunnel

1. Cloudflare dashboard → **Zero Trust** → **Networks** → **Tunnels** →
   **Create a tunnel** → **Cloudflared**.
2. Name it — `cipher` does fine — and save.
3. The install instructions that appear contain a long `--token eyJ...` string.
   **Copy just the token.** You are not installing cloudflared by hand; it runs
   as a container. The token is a credential: anyone holding it can publish a
   tunnel as you.
4. **Public Hostnames** → **Add a public hostname**:

   | Field | Value |
   |---|---|
   | Subdomain | `cipher` |
   | Domain | `findiepman.dev` |
   | Path | *(empty)* |
   | Type | `HTTP` |
   | URL | `web:80` |

   `web` is the compose service name, which cloudflared resolves on the Docker
   network. Saving this creates the proxied CNAME in your DNS automatically —
   you do not add an A or CNAME record yourself.

5. Two zone settings worth checking once:
   - **SSL/TLS → Overview**: set the mode to **Full**. Anything weaker
     downgrades the edge connection for no benefit here.
   - **Network → WebSockets**: on. It is on by default, and live message
     delivery is a websocket — without it, messages arrive only on reload.

---

## Step 3 — The box

### 3.1 Docker and the repo

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y ca-certificates curl git

curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"
# log out and back in (or `newgrp docker`) before the next line works
docker run --rm hello-world
```

The repository is public, so the box can clone it with no credentials:

```bash
git clone https://github.com/Findiepman/encrypted-messenger.git ~/cipher
cd ~/cipher
```

`deploy.sh` runs `git pull`, which also needs no credentials while the repo
stays public.

<details>
<summary>If you make the repository private again</summary>

The box then needs its own read access — permanently, not just for the initial
clone, because `deploy.sh` pulls. A read-only deploy key is the right shape: it
is scoped to this one repository and cannot push.

```bash
ssh-keygen -t ed25519 -C "fin-server deploy key" -f ~/.ssh/id_ed25519 -N ""
cat ~/.ssh/id_ed25519.pub
```

Add it at **repo → Settings → Deploy keys → Add deploy key**, titled
`fin-server`, with **"Allow write access" unchecked**. Then re-point the
existing clone at the SSH URL:

```bash
git -C ~/cipher remote set-url origin git@github.com:Findiepman/encrypted-messenger.git
```

</details>

### A public repo is fine; these two things are the reason to think about it

Nothing secret is in the repository — no `.env` has ever been committed, and
every credential-shaped value in the history is an empty placeholder. Secrets
live only in `deploy/.env` on the box, which is gitignored.

What *is* now public is an accurate description of this deployment's weak
points: that message bodies are stored readable under phase 1, that CSRF tokens
are unbuilt, and the exact hostname serving it. None of that is a vulnerability
on its own, and hiding it would be security through obscurity. But combined
with **registration being open to anyone who finds the URL**, it is worth being
a decision rather than an accident. See "Restricting who can register" below.

### 3.2 Configure

```bash
cp deploy/.env.example deploy/.env
chmod 600 deploy/.env
```

The file documents every value. These are the ones that must be right:

| Key | Value |
|---|---|
| `APP_URL` | `https://cipher.findiepman.dev` — no trailing slash |
| `POSTGRES_PASSWORD` | `openssl rand -base64 32` |
| `JWT_SECRET` | `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |
| `SMTP_PASSWORD` | the Resend API key from step 1.2 |
| `MAIL_FROM` | `"Cipher <no-reply@findiepman.dev>"` — on the verified domain |
| `CLOUDFLARE_TUNNEL_TOKEN` | the token from step 2.3 |

`APP_URL` is load-bearing three separate ways: it is the origin the CORS
allowlist permits, the base of every link in every email, and the origin the
cookies come back to. One wrong character produces verification links nobody
can open.

The file must be named `deploy/.env` exactly. Compose reads that name
automatically for both the `${...}` substitutions and the server's environment.
Any other name needs `--env-file` on every command, and forgetting it fails
confusingly — substitution silently yields empty strings.

### 3.3 Deploy

```bash
./deploy/deploy.sh
```

It checks `deploy/.env` for empty values before building, dumps the database
first (a no-op on the first run), builds both images, starts the stack, and
waits for the server to report healthy. The first build takes a few minutes;
later ones reuse the dependency layers.

Migrations are applied by the server container on start, not by the deploy
script, so the schema is always applied by the exact build about to serve it.

---

## Step 4 — Verify it, in this order

```bash
docker compose -f deploy/docker-compose.prod.yml ps           # four containers up
docker compose -f deploy/docker-compose.prod.yml logs server  # migrations, then listening
```

Then in a browser:

1. `https://cipher.findiepman.dev` loads and shows the sign-in screen.
2. **Open the browser console before creating an account.** A Content-Security-
   Policy error is the one predictable failure of this setup: libsodium is
   WebAssembly, and if key generation is blocked, signup fails with no visible
   cause. See troubleshooting.
3. Create an account. The verification email should arrive within a minute.
4. Click the link, sign in, confirm the app loads.
5. Create a second account, befriend it by exact username from the first, and
   send a message both ways. Watch it arrive **without a reload** — that is the
   websocket, and it is the part a tunnel is most likely to have broken.

---

## Step 5 — Harden the box

With a tunnel there is nothing inbound to expose, so this is short:

```bash
# SSH keys only. Confirm your key works in a SECOND terminal before this.
sudo sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sudo systemctl restart ssh

# Deny everything inbound except SSH from the LAN.
sudo apt install -y ufw
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow from 192.168.0.0/16 to any port 22 proto tcp
sudo ufw enable

sudo apt install -y unattended-upgrades fail2ban
sudo dpkg-reconfigure --priority=low unattended-upgrades
```

Note that ufw does not filter Docker's own published ports — which is fine
here precisely because this stack publishes none.

---

## Restricting who can register

`cipher.findiepman.dev` is public DNS, and the app has no invite system: anyone
who reaches it can create an account. Email verification and the rate limits
mean it is not trivially abusable, but nothing restricts *who* may sign up.

For a couple of testers that is worth closing, and it takes no code. Cloudflare
Zero Trust → **Access** → **Applications** → **Add an application** →
**Self-hosted**:

| Field | Value |
|---|---|
| Application domain | `cipher.findiepman.dev` |
| Policy action | Allow |
| Include | Emails → your address, and your co-worker's |

Cloudflare then requires a one-time email code before the request ever reaches
the tunnel, so unknown visitors never touch the app at all. It sits in front of
the app's own auth rather than replacing it — you still sign in normally
afterwards.

Two caveats worth knowing before you turn it on:

- It applies to **every** path on the hostname, `/socket.io` included.
  Browsers carry the Access cookie automatically, so the websocket is fine, but
  anything non-browser hitting the API would need a service token.
- Remove the application when you want the app genuinely open, not just for
  testing. It is a gate on the hostname, not a feature of the app.

Leaving it off is a legitimate choice too — just make it a choice. The thing
not to do is assume the URL is unguessable, because the public repository
documents the hostname.

## Step 6 — Backups

```bash
crontab -e
```

```cron
17 3 * * * BACKUP_DIR=/mnt/backup/cipher /home/YOU/cipher/deploy/backup.sh >> /home/YOU/cipher-backup.log 2>&1
```

`backup.sh` writes a gzipped `pg_dump`, checks it is not empty, and only then
deletes dumps older than 14 days. **Point `BACKUP_DIR` at another disk.** The
default `/var/backups/cipher` sits on the same drive as the Docker volume, and
a backup that dies with the drive it was protecting against is not a backup.

Test the restore path once, now, while nothing is at stake:

```bash
./deploy/restore.sh /var/backups/cipher/messenger-<stamp>.sql.gz
```

An untested backup is a guess.

---

## Operating it

```bash
cd ~/cipher

./deploy/deploy.sh                                            # pull, build, restart
./deploy/deploy.sh --no-pull                                  # deploy the working tree

docker compose -f deploy/docker-compose.prod.yml logs -f server
docker compose -f deploy/docker-compose.prod.yml restart server
docker compose -f deploy/docker-compose.prod.yml exec postgres psql -U messenger messenger
```

**Rotating `JWT_SECRET` signs everyone out.** That is the intended way to
revoke every session at once, and currently the only way — there is no admin
UI.

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| Signup fails; console shows a CSP error mentioning `wasm` | libsodium's WebAssembly is blocked. `deploy/Caddyfile` allows `'wasm-unsafe-eval'`; a build that falls back to asm.js would need `'unsafe-eval'`. Add that only after confirming it is the actual error — it is a real weakening. |
| Messages appear only after a reload | The websocket is not connecting. Check **Network → WebSockets** is on in Cloudflare, and that the tunnel's public hostname points at `web:80`, not `web:3000`. |
| Verification emails never arrive | Read `logs server` for an SMTP error, then run `npm run mail:test` from the box, then check spam. In that order. |
| The server container restarts in a loop | Read the first lines of `logs server`. `env.ts` fails loudly at boot on a missing or invalid value and names it. |
| Everything is green but the hostname 404s | The tunnel's public hostname is wrong, or points at a service name that is not `web`. |
| `docker compose` complains about an unset variable | You are running without `deploy/.env`, or from the wrong directory. |
| Login works, then signs you out after 15 minutes | The refresh cookie is not coming back. It is scoped to `Path=/auth`; if you move the API under a different prefix in the Caddyfile, that scope has to move with it. |

---

## Not covered here, deliberately

- **Phase 2 encryption is not on.** `encryptMessage` is still a base64 no-op,
  so the server stores readable message bodies. On a box in your house that you
  alone administer, that is your own data on your own disk — but it stops being
  true the moment anyone else has a login, or a backup goes somewhere shared.
  The dumps `backup.sh` writes contain readable messages. Treat them that way.
- **CSRF tokens.** Still unbuilt; same-origin plus `SameSite=Lax` is carrying
  that weight. `backend-plan.md` step 6.
- **Presence is per-process.** Correct on one box, wrong the day there are two.
