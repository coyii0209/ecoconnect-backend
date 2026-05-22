# EcoConnect Backend Deployment Guide

## Prerequisites

- Node.js v18+ installed
- systemd available (Linux/Raspberry Pi)
- `better-sqlite3` and all npm dependencies installed

## Installation

1. **Clone and setup**
   ```bash
   git clone <repo> ecoconnect
   cd ecoconnect/backend
   npm install
   ```

2. **Environment Configuration**
   Create `.env` file:
   ```bash
   DETECTOR_TOKEN=your-secure-token-here
   CONFIDENCE_THRESHOLD=0.8
   REWARD_PLASTIC_BOTTLE=5
   REWARD_DEFAULT=0
   REWARD_MODE=allow_zero
   PORT=3000
   ```

3. **Copy systemd units**
   ```bash
   sudo cp deploy/systemd/ecoconnect-backend.service /etc/systemd/system/
   sudo cp deploy/systemd/ecoconnect-detector.service /etc/systemd/system/
   sudo systemctl daemon-reload
   ```

## Running the Backend

### One-Command Deploy Helper

Use the included script from project root:

```bash
./deploy.sh dev
```

This will:
- optionally pull latest code (if `GIT_PULL=1`)
- create `.env` from `.env.example` if missing
- run `pnpm install`
- start backend in dev mode

For Linux/systemd deployment:

```bash
./deploy.sh prod
```

Optional with repository update:

```bash
GIT_PULL=1 ./deploy.sh prod
```

### Development
```bash
npm run dev
```
Server starts on `http://localhost:3000`

### Production with systemd
```bash
# Enable auto-start on boot
sudo systemctl enable ecoconnect-backend
sudo systemctl enable ecoconnect-detector

# Start services
sudo systemctl start ecoconnect-backend
sudo systemctl start ecoconnect-detector

# Check status
sudo systemctl status ecoconnect-backend
sudo systemctl status ecoconnect-detector

# View logs
sudo journalctl -u ecoconnect-backend -f
sudo journalctl -u ecoconnect-detector -f
```

## API Health Check

```bash
curl http://localhost:3000/api/health
```

Expected response:
```json
{
  "status": "online",
  "database": true
}
```

## Troubleshooting

- **Service fails to start**: Check logs with `journalctl -u ecoconnect-backend -n 50`
- **Database locked**: Ensure only one instance is running. Check for orphaned processes.
- **Port 3000 in use**: Change `PORT` in `.env` or kill conflicting process.

## Avoid GitHub Username/Token Prompts

If `GIT_PULL=1` asks for GitHub username/token, switch your remote to SSH and use a key.

1. Generate key (if missing):
   ```bash
   ssh-keygen -t ed25519 -C "your-email@example.com"
   ```
2. Add public key to GitHub:
   ```bash
   cat ~/.ssh/id_ed25519.pub
   ```
   Copy it into GitHub -> Settings -> SSH and GPG keys.
3. Change remote to SSH:
   ```bash
   git remote set-url origin git@github.com:<owner>/<repo>.git
   ```
4. Test:
   ```bash
   ssh -T git@github.com
   ```

This removes repeated username/token prompts in deploy scripts.
