# Deploying

One Linux box. The app runs under systemd, Caddy handles HTTPS in front of it,
and the database is a file on the instance's disk. Why this rather than a
serverless platform and a managed Postgres is in `docs/ARCHITECTURE.md` under
"Hosting".

## The whole thing

```sh
# on a fresh Ubuntu instance
git clone https://github.com/<you>/gyges-online.git
cd gyges-online
DOMAIN=gyges.example.com bash deploy/setup.sh
```

That is the deploy. `setup.sh` installs swap, Node, Caddy and the service,
builds the site, and starts it. It is safe to re-run.

Afterwards, every update is:

```sh
bash deploy/deploy.sh
```

## Before the first run

1. **An instance.** Lightsail, Ubuntu LTS — the *plain OS* blueprint, not the
   Node.js one. The Node blueprints are Bitnami stacks with their own bundled
   Apache, their own directory layout under `/opt/bitnami`, and a Node version
   that tends to lag; you would spend the time you saved fighting a reverse
   proxy you did not ask for.

   The $5 tier (512 MB) works because `setup.sh` adds swap — without it the
   build gets OOM-killed, which looks like a crash rather than a shortage. If
   the build's slowness annoys you, snapshot the instance and restore it onto a
   bigger one; it is not a one-way door.

2. **A static IP,** attached to the instance. Lightsail includes one. Not the
   default public address — that changes when the instance stops, and takes the
   site with it.

3. **DNS pointing here, before you run setup.** An A record for the apex at the
   static IP, and `www` as a second A record or a CNAME to the apex. Caddy
   proves it controls the name over port 80 before Let's Encrypt will issue a
   certificate, so the name has to resolve first. A TTL of 300 while setting up
   makes mistakes cheap.

4. **Ports 80 and 443 open** in the Lightsail networking tab. Port 80 carries
   no traffic of its own; it answers the certificate challenge.

## Backups

`setup.sh` deliberately does not set this up, because it needs a bucket and
credentials that are yours.

```sh
aws s3 mb s3://gyges-backups-<something-unique>
aws configure                       # or an instance role, on EC2
crontab -e
```

```cron
0 4 * * * GYGES_BACKUP_BUCKET=gyges-backups-<yours> bash /home/ubuntu/gyges-online/deploy/backup.sh >> /var/log/gyges-backup.log 2>&1
```

`backup.sh` uses SQLite's online backup API, so it is safe to run while the
site is serving — unlike `cp`, which can catch the file mid-write. It keeps 14
days locally and sends every copy to the bucket.

**A copy on the same disk is not a backup.** It protects against a bad UPDATE
and against nothing else. Take Lightsail snapshots as well — those cover the
whole machine — but the bucket is what survives losing the instance.

## Watching it

An external ping (Healthchecks.io, UptimeRobot; both free at this size) beats
CloudWatch here: what you want to know is whether the site answers, not whether
the instance is powered on.

```sh
systemctl status gyges        # is it running
journalctl -u gyges -f        # what it is saying
journalctl -u caddy -n 50     # certificate trouble lives here
```

## Layout

| | |
|---|---|
| App | wherever you cloned it, e.g. `/home/ubuntu/gyges-online` |
| Database | `/var/lib/gyges/gyges.db` |
| Backups | `/var/lib/gyges/backups/` |
| Service | `/etc/systemd/system/gyges.service` |
| Caddy | `/etc/caddy/Caddyfile` |

The database lives outside the repo on purpose: a deploy replaces the working
tree, and the database must never be anywhere near that.

## Things that will bite

- **Never put the database on EFS**, or any network filesystem. SQLite's
  locking assumes a local disk; over NFS it can corrupt rather than merely
  underperform. The instance's own disk is a block device and is fine.
- **One machine against the file.** Several processes on one host are fine —
  SQLite locks properly — but never two instances sharing a volume.
- **Never copy `node_modules` from your laptop.** `better-sqlite3` is compiled
  for the machine it is installed on. `npm ci` on the box, always.
- **`GYGES_INSECURE_COOKIES` must stay unset.** It exists so LAN testing over
  plain http works; set here it stops session cookies being Secure.
- **Migrations run themselves** when the app opens the database, so a deploy
  needs no migration step. `npm run db:migrate -- --status` shows what has run.

## Restoring

```sh
aws s3 cp s3://<bucket>/gyges-2026-09-02T04-00-00.db /tmp/restore.db
sudo systemctl stop gyges
cp /tmp/restore.db /var/lib/gyges/gyges.db
sudo systemctl start gyges
```

Stop the service first. Copying a database over one that is open is how a
restore turns into a second outage.
