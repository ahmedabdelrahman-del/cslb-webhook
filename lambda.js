const crypto = require("crypto");
const express = require("express");
const bodyParser = require("body-parser");
const serverless = require("serverless-http");

const ORG = "test3032001";
const CSLB_TOPIC = "cslb-id-2343";

function requireToken() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("Missing GITHUB_TOKEN env var");
  return token;
}

function parseJsonBody(req) {
  const body = req.body;
  if (!body) return {};

  // Buffers and typed arrays (common under serverless-http) need explicit decode + parse.
  if (Buffer.isBuffer(body) || ArrayBuffer.isView(body)) {
    try {
      return JSON.parse(Buffer.from(body).toString("utf8"));
    } catch (_e) {
      return {};
    }
  }

  if (typeof body === "string") {
    try {
      return JSON.parse(body);
    } catch (_e) {
      return {};
    }
  }

  if (typeof body === "object") return body;
  return {};
}

function verifySignatureFromParts({ secret, signatureHeader, rawBodyBuffer }) {
  try {
    if (!secret || !signatureHeader || !rawBodyBuffer) return false;

    const prefix = "sha256=";
    if (!signatureHeader.startsWith(prefix)) return false;

    const sigHex = signatureHeader.slice(prefix.length);
    if (sigHex.length !== 64) return false; // 32 bytes in hex

    const expectedHex = crypto
      .createHmac("sha256", secret)
      .update(rawBodyBuffer)
      .digest("hex");

    const sigBuf = Buffer.from(sigHex, "hex");
    const expBuf = Buffer.from(expectedHex, "hex");
    if (sigBuf.length !== expBuf.length) return false;

    return crypto.timingSafeEqual(expBuf, sigBuf);
  } catch (err) {
    console.error("Signature verification error:", err.message);
    return false;
  }
}

const app = express();

app.use(bodyParser.json({ type: "*/*" }));

app.get(["/", "/prod", "/prod/"], (_req, res) => {
  res.status(200).send("✅ Webhook server is running");
});

// Allow simple GET checks on the webhook path (API Gateway console/curl health checks)
app.get(["/webhook", "/prod/webhook"], (_req, res) => {
  res.status(200).send("ok");
});

app.post(["/webhook", "/prod/webhook"], async (req, res) => {
  try {
    console.log("Webhook request received");
    console.log("req.body typeof:", typeof req.body);

    const body = parseJsonBody(req);

    console.log("parsed body keys:", Object.keys(body || {}));
    console.log("body.repository:", body?.repository?.full_name);
    const event = req.header("X-GitHub-Event");

    if (event === "ping") return res.status(200).send("pong");

    if (event === "push") {
      const owner = body?.repository?.owner?.login;
      const repo = body?.repository?.name;

      if (!owner || !repo) return res.status(400).send("missing repo info");
      if (owner !== ORG) return res.status(200).send("ignored - not our org");
    } else if (event === "repository") {
      const action = body?.action;
      if (action !== "created") return res.status(200).send("ignored - not a creation");
    } else {
      return res.status(200).send("ignored - unsupported event");
    }

    const owner = body?.repository?.owner?.login;
    const repo = body?.repository?.name;

    if (owner !== ORG) return res.status(200).send("ignored");

    const GITHUB_TOKEN = requireToken();
    console.log(`Processing webhook for ${owner}/${repo}`);

    const getResp = await fetch(`https://api.github.com/repos/${owner}/${repo}/topics`, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });

    const getJson = await getResp.json();

    if (!getResp.ok) {
      console.error("Failed to get topics:", getResp.status, getJson);
      return res.status(500).send("failed to get topics");
    }

    const topics = new Set(getJson.names || []);
    topics.add(CSLB_TOPIC);

    console.log(`Adding topic ${CSLB_TOPIC} to ${owner}/${repo}. Topics:`, Array.from(topics));

    const putResp = await fetch(`https://api.github.com/repos/${owner}/${repo}/topics`, {
      method: "PUT",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ names: Array.from(topics) }),
    });

    if (!putResp.ok) {
      const txt = await putResp.text();
      console.error("Failed to set topics:", putResp.status, txt);
      return res.status(500).send("failed");
    }

    console.log(`✅ Added ${CSLB_TOPIC} to ${owner}/${repo}`);
    return res.status(200).send("ok");
  } catch (err) {
    console.error("Webhook error:", err.message);
    return res.status(401).send("unauthorized");
  }
});

const serverlessHandler = serverless(app);

module.exports.handler = async (event, context) => {
  const secret = process.env.WEBHOOK_SECRET;

  const headers = event.headers || {};
  // Normalize header casing because API Gateway may lowercase keys
  const signatureHeader = headers["x-hub-signature-256"] || headers["X-Hub-Signature-256"];

  let rawBodyBuffer = null;
  if (typeof event.body === "string") {
    rawBodyBuffer = event.isBase64Encoded
      ? Buffer.from(event.body, "base64")
      : Buffer.from(event.body, "utf8");
  }

  const signatureOk = verifySignatureFromParts({
    secret,
    signatureHeader,
    rawBodyBuffer,
  });

  if (!signatureOk) {
    console.log("Signature verification failed (handler)");
    return {
      statusCode: 401,
      headers: { "content-type": "text/plain" },
      body: "bad signature",
    };
  }

  console.log("Signature OK (handler), invoking Express");

  // Pass the decoded body string to Express; keep base64 flag false to avoid double decoding.
  if (rawBodyBuffer) {
    event.body = rawBodyBuffer.toString("utf8");
    event.isBase64Encoded = false;
  }

  return serverlessHandler(event, context);
};
