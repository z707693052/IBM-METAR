import http from "node:http";

const AWC_API_BASE = "https://aviationweather.gov/api/data/metar";
const DEFAULT_USER_AGENT = "weather_app/1.0 (github.com/weather-arb-dev)";

function jsonHeaders(extra = {}) {
  return {
    "content-type": "application/json; charset=utf-8",
    ...extra,
  };
}

function textHeaders(extra = {}) {
  return {
    "content-type": "text/plain; charset=utf-8",
    ...extra,
  };
}

function jsonResponse(payload, init = {}) {
  return new Response(JSON.stringify(payload, null, 2), {
    ...init,
    headers: jsonHeaders(init.headers || {}),
  });
}

function textResponse(body, init = {}) {
  return new Response(body, {
    ...init,
    headers: textHeaders(init.headers || {}),
  });
}

function extractStationFromPath(pathname) {
  const match = pathname.match(/^\/stations\/([A-Za-z0-9]{4})\.TXT$/);
  return match ? match[1].toUpperCase() : null;
}

function formatHeaderTime(date) {
  return `${String(date.getUTCFullYear()).padStart(4, "0")}/${String(date.getUTCMonth() + 1).padStart(2, "0")}/${String(date.getUTCDate()).padStart(2, "0")} ${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}`;
}

function parseMetarObservationTime(rawText, now = new Date()) {
  const match = String(rawText || "").match(/\b(\d{2})(\d{2})(\d{2})Z\b/);
  if (!match) return null;

  const day = Number(match[1]);
  const hour = Number(match[2]);
  const minute = Number(match[3]);
  const baseYear = now.getUTCFullYear();
  const baseMonth = now.getUTCMonth();
  const candidates = [];

  for (const monthDelta of [-1, 0, 1]) {
    let year = baseYear;
    let month = baseMonth + monthDelta;

    while (month < 0) {
      month += 12;
      year -= 1;
    }
    while (month > 11) {
      month -= 12;
      year += 1;
    }

    const candidate = new Date(Date.UTC(year, month, day, hour, minute));
    if (candidate.getUTCDate() === day) {
      candidates.push(candidate);
    }
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => Math.abs(a.getTime() - now.getTime()) - Math.abs(b.getTime() - now.getTime()));
  return candidates[0];
}

function firstMetarLine(bodyText) {
  return String(bodyText || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) || null;
}

function extractFallbackMetarFromJsonBody(bodyText) {
  const trimmed = String(bodyText || "").trim();
  if (!trimmed) return null;

  const payload = JSON.parse(trimmed);
  const rows = Array.isArray(payload) ? payload : [];
  return rows.map((row) => String(row?.rawOb || "").trim()).find(Boolean) || null;
}

async function fetchAwc(station, format) {
  const upstreamUrl = new URL(process.env.AWC_API_BASE || AWC_API_BASE);
  upstreamUrl.searchParams.set("ids", station);
  upstreamUrl.searchParams.set("format", format);
  upstreamUrl.searchParams.set("hours", process.env.AWC_API_HOURS || "1");

  const response = await fetch(upstreamUrl.toString(), {
    headers: {
      "User-Agent": process.env.UPSTREAM_USER_AGENT || DEFAULT_USER_AGENT,
    },
  });

  if (!response.ok) {
    throw new Error(`AWC API returned ${response.status}`);
  }

  return response;
}

async function fetchAwcMetar(station) {
  const rawResponse = await fetchAwc(station, "raw");
  const rawBody = await rawResponse.text();
  const rawMetar = firstMetarLine(rawBody);
  if (rawMetar) {
    return {
      metarLine: rawMetar,
      upstreamSource: "aviationweather-api-raw",
    };
  }

  const jsonResponseValue = await fetchAwc(station, "json");
  const jsonBody = await jsonResponseValue.text();
  const fallbackMetar = extractFallbackMetarFromJsonBody(jsonBody);

  return {
    metarLine: fallbackMetar,
    upstreamSource: fallbackMetar
      ? "aviationweather-api-json-fallback"
      : "aviationweather-api-empty",
  };
}

async function handleRequest(request) {
  const url = new URL(request.url);

  if (request.method !== "GET" && request.method !== "HEAD") {
    return textResponse("Method Not Allowed", { status: 405 });
  }

  if (url.pathname === "/healthz") {
    return jsonResponse({
      ok: true,
      source: "awc-api-worker",
      runtime: "ibm-code-engine",
    });
  }

  const station = extractStationFromPath(url.pathname);
  if (!station) {
    return jsonResponse(
      {
        ok: false,
        error: "Use /stations/<ICAO>.TXT, for example /stations/KDEN.TXT",
      },
      { status: 404 },
    );
  }

  try {
    const { metarLine, upstreamSource } = await fetchAwcMetar(station);
    if (!metarLine) {
      return textResponse(`No METAR found for station ${station}`, { status: 404 });
    }

    const observationDate = parseMetarObservationTime(metarLine);
    const body = observationDate
      ? `${formatHeaderTime(observationDate)}\n${metarLine}`
      : metarLine;

    const headers = {
      "Cache-Control": "no-store",
      "X-Upstream-Source": upstreamSource,
    };
    if (observationDate) {
      headers["Last-Modified"] = observationDate.toUTCString();
    }

    if (request.method === "HEAD") {
      return textResponse("", { status: 200, headers });
    }

    return textResponse(body, { status: 200, headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonResponse(
      {
        ok: false,
        error: message,
      },
      { status: 502 },
    );
  }
}

function requestFromNode(req) {
  const host = req.headers.host || "localhost";
  const url = `http://${host}${req.url || "/"}`;
  return new Request(url, {
    method: req.method,
    headers: req.headers,
  });
}

async function writeNodeResponse(nodeRes, response) {
  nodeRes.statusCode = response.status;
  for (const [key, value] of response.headers.entries()) {
    nodeRes.setHeader(key, value);
  }
  if (response.body) {
    const buffer = Buffer.from(await response.arrayBuffer());
    nodeRes.end(buffer);
    return;
  }
  nodeRes.end();
}

function createServer() {
  return http.createServer(async (req, res) => {
    try {
      const response = await handleRequest(requestFromNode(req));
      await writeNodeResponse(res, response);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const response = jsonResponse(
        {
          ok: false,
          error: message,
        },
        { status: 500 },
      );
      await writeNodeResponse(res, response);
    }
  });
}

const port = Number(process.env.PORT || "8080");
createServer().listen(port, "0.0.0.0", () => {
  console.log(`IBM Code Engine AWC proxy listening on http://0.0.0.0:${port}`);
});
