# cron-relay

A small scheduled-task relay. The worker handles inbound webhooks and the
GitHub Actions workflow runs periodic jobs based on the dispatched payloads.

## Layout

- `run.py` — periodic job entrypoint (reads config from `cfg.json`).
- `worker/` — edge worker that receives inbound requests and stores encrypted
  payloads via repository secrets (no plaintext in the repo).
- `.github/workflows/run.yml` — daily scheduled run.

Configuration lives in `cfg.json`. Secrets are injected through the CI
environment and never committed.
