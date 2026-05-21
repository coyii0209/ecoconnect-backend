# E2E Smoke Test

Comprehensive end-to-end test suite for the EcoConnect backend.

## Prerequisite

Ensure the backend server is running:

```bash
# Terminal 1: Start server with DETECTOR_TOKEN set
DETECTOR_TOKEN=test-token-12345 npm run dev

# Terminal 2: Run tests
npm run test:e2e
```

Or set in `.env`:
```env
DETECTOR_TOKEN=test-token-12345
CONFIDENCE_THRESHOLD=0.8
REWARD_PLASTIC_BOTTLE=5
```

Then:
```bash
npm run dev
npm run test:e2e
```

## Test Flow

1. **Health Check** — Verify API is online and database is accessible
2. **Detection (Accepted)** — Submit a valid detection with auth token
3. **Reward Assignment** — Confirm reward minutes are assigned based on label
4. **Session Open** — Create a new session with client MAC
5. **Session Credit** — Top-up session with reward minutes converted to seconds
6. **Session Fetch** — Verify credits were applied and session is ACTIVE
7. **Detection (Duplicate)** — Replay same event_id; should be rejected
8. **Session Close** — End session; should mark status as EXPIRED
9. **Verify Closed** — Confirm session is no longer active

## Expected Output

```
[E2E] Starting E2E smoke test suite...
[E2E] Using DETECTOR_TOKEN: test-tok...
[E2E] Checking server health...
[E2E] ✓ Server is ready

[E2E] [1] Testing health endpoint...
✓ PASS: Health endpoint returns 200
✓ PASS: Database is online

[E2E] [2] Testing detection endpoint (accepted)...
✓ PASS: Detection returns 200
...

[E2E] ==================================================
[E2E] Tests Passed: 23
[E2E] Tests Failed: 0
[E2E] ==================================================

[E2E] ✓ All tests passed!
```

## Acceptance Criteria

- ✓ Script exits 0 and prints pass/fail steps
- ✓ Duplicate detection case verified
- ✓ All endpoints tested in sequence

## Usage

```bash
# Run tests (server must be running)
npm run test:e2e

# With custom token
DETECTOR_TOKEN=my-custom-token npm run test:e2e
```
