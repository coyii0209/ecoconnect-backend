# EcoConnect Fast-Track Task Board

Date: 2026-05-21
Goal: Ship a working bottle-as-payment backend fast with 2 people in parallel.

## Working Rules (Speed Mode)

- Daily merge windows only: 12:00, 16:00, 20:00.
- Contract-first: do not change payloads after 12:00 freeze.
- One owner per file area to reduce conflicts.
- Every task must have a runnable verification command.

## Ownership Split

Person A owns:
- src/database/sqlite.js
- src/services/session.service.js
- src/api/routes/session.routes.js

Person B owns:
- src/api/routes/detection.routes.js
- src/services/reward.service.js
- src/api/routes/health.routes.js
- deployment docs and systemd files

Shared file (edit only during merge window):
- src/app.js

## Day 1 (Today) - Critical Path

### A1 - Session Schema + Migration Layer
Owner: Person A
Estimate: 2.5h
Files:
- src/database/sqlite.js
Deliverables:
- Add tables: sessions, transactions, devices, hotspot_events
- Add indexes on created_at, session_token, client_mac
- Add simple schema version table
Acceptance checks:
- App starts without SQL errors
- New tables exist in SQLite
- Existing detections/rewards still work

### A2 - Session Service Core
Owner: Person A
Estimate: 3h
Files:
- src/services/session.service.js
Deliverables:
- openSession(clientMac)
- creditSession(sessionToken, seconds)
- consumeSession(sessionToken, seconds)
- closeSession(sessionToken)
- getSession(sessionToken)
Acceptance checks:
- Time never goes below zero
- Expired sessions return inactive
- Credit and consume are transactional

### A3 - Session Routes
Owner: Person A
Estimate: 1.5h
Files:
- src/api/routes/session.routes.js
Deliverables:
- POST /api/session/open
- POST /api/session/credit
- POST /api/session/consume
- POST /api/session/close
- GET /api/session/:token
Acceptance checks:
- Input validation works for all endpoints
- Error responses are consistent JSON

### B1 - Detection Auth + Validation Hardening
Owner: Person B
Estimate: 2.5h
Files:
- src/api/routes/detection.routes.js
Deliverables:
- Add bearer token auth for detector
- Validate label, confidence, event_id, camera_id
- Add low-confidence rejection by env threshold
Acceptance checks:
- Unauthorized calls return 401
- Missing fields return 400
- Low confidence returns deterministic reject reason

### B2 - Anti-Duplicate + Cooldown
Owner: Person B
Estimate: 2h
Files:
- src/api/routes/detection.routes.js
- src/database/sqlite.js
Deliverables:
- event_id idempotency guard
- cooldown by camera_id/session
- reject reason logging
Acceptance checks:
- Replayed event_id never double-credits
- Rapid repeats during cooldown are rejected

### B3 - Reward Rules Config
Owner: Person B
Estimate: 1.5h
Files:
- src/services/reward.service.js
Deliverables:
- Move hardcoded reward map to config/env
- Keep default plastic_bottle behavior
Acceptance checks:
- Reward values can be changed without code edits
- Unknown labels return zero or reject by policy

### B4 - Pi Service Boot Wiring
Owner: Person B
Estimate: 2h
Files:
- docs/deployment.md
- deploy/systemd/ecoconnect-backend.service
- deploy/systemd/ecoconnect-detector.service
Deliverables:
- systemd unit files for backend and detector
- startup/restart instructions
Acceptance checks:
- Services restart on failure
- Boot test starts both services automatically

## Day 2 - Integration and Reliability

### A4 - Session Time Worker Hook
Owner: Person A
Estimate: 2h
Files:
- src/services/session.service.js
- src/api/routes/session.routes.js
Deliverables:
- Safe consume path for hotspot polling/worker
- Session expiry enforcement
Acceptance checks:
- Simulated consume loop decrements correctly
- Expired sessions cannot be credited without reopen policy

### B5 - Mock Hotspot Adapter
Owner: Person B
Estimate: 3h
Files:
- src/services/hotspot.service.js
- src/services/session.service.js
Deliverables:
- createAccess, extendAccess, revokeAccess mock calls
- wire calls during session credit/close
Acceptance checks:
- Credit triggers create/extend access path
- Close triggers revoke path

### Joint J1 - End-to-End Test Script
Owner: Pair
Estimate: 2h
Files:
- scripts/e2e-smoke.sh
Deliverables:
- One command script: detection -> reward -> session credit -> session fetch
Acceptance checks:
- Script exits 0 and prints pass/fail steps
- Duplicate detection case verified

## API Contract Freeze (Today 12:00)

Detection request:
- label: string
- confidence: number
- event_id: string
- camera_id: string
- captured_at: ISO timestamp

Detection response:
- accepted: boolean
- reason: accepted | low_confidence | duplicate_event | cooldown | invalid_label | unauthorized
- reward_minutes: number
- detection_id: number|null
- session_token: string|null

## Merge Windows

- 12:00: Freeze payload and status codes
- 16:00: First full integration on one branch
- 20:00: Pi smoke run candidate

## Definition of Done (Fast Release)

- Detection endpoint is authenticated and idempotent
- Session open/credit/consume/close is live
- Reward assignment updates session time
- Mock hotspot integration wired
- Services auto-start on Raspberry Pi reboot
- One end-to-end smoke script passes

## Command Checklist

- npm run dev
- curl health endpoint
- curl detection accepted case
- curl detection duplicate case
- curl session open + credit + consume + close
- sudo systemctl daemon-reload
- sudo systemctl enable ecoconnect-backend
- sudo systemctl enable ecoconnect-detector
