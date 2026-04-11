# IBM Code Engine AWC Proxy

IBM Code Engine application version of the AWC API proxy.

Public routes:

- `/healthz`
- `/stations/<ICAO>.TXT`

Behavior:

- fetches `https://aviationweather.gov/api/data/metar`
- tries `format=raw` first
- falls back to `format=json` and `rawOb` if the raw response is empty
- reshapes successful station responses into the tgftp-style two-line body:
  - `YYYY/MM/DD HH:MM`
  - `METAR ...`

## Files

- [server.mjs](/Users/keyouzeng/.openclaw/workspace/kalshi_weather_bot/latency_arb_awc_cache_service/ibm_code_engine/server.mjs)
- [package.json](/Users/keyouzeng/.openclaw/workspace/kalshi_weather_bot/latency_arb_awc_cache_service/ibm_code_engine/package.json)
- [Dockerfile](/Users/keyouzeng/.openclaw/workspace/kalshi_weather_bot/latency_arb_awc_cache_service/ibm_code_engine/Dockerfile)

## GitHub + IBM Code Engine

This folder is designed for a Code Engine **Application**.

If you deploy from GitHub source, use:

- root directory:
  - `latency_arb_awc_cache_service/ibm_code_engine`
- build from source:
  - yes
- component type:
  - `Application`

Two workable build strategies:

1. Let Code Engine detect the Node app from [package.json](/Users/keyouzeng/.openclaw/workspace/kalshi_weather_bot/latency_arb_awc_cache_service/ibm_code_engine/package.json)
2. Or use the included [Dockerfile](/Users/keyouzeng/.openclaw/workspace/kalshi_weather_bot/latency_arb_awc_cache_service/ibm_code_engine/Dockerfile) for a more explicit build path

Recommended runtime shape:

- public visibility
- small CPU / memory
- min instances: `0`
- max instances: `10`
- request timeout: `30s`

The app listens on the `PORT` environment variable and defaults to `8080`, which matches Code Engine expectations.
