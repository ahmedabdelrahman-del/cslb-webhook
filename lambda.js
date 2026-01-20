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

function verifySignature(req) {
  try {
    const secret = process.env.WEBHOOK_SECRET;
    console.log("WEBHOOK_SECRET set:", !!secret);
    if (!secret) return false;

    const sig = req.get("X-Hub-Signature-256");
    const raw = req.rawBody;
    console.log("Signature header:", sig ? "present" : "missing");
    console.log("Raw body:", raw ? `${raw.length} bytes` : "missing");
    if (!sig || !raw) return false;

    const hmac = crypto.createHmac("sha256", secret).update(raw).digest("hex");
    const expected = `sha256=${hmac}`;
    console.log("Expected sig:", expected.substring(0, 20) + "...");
    console.log("Received sig:", sig.substring(0, 20) + "...");

    const sigBuf = Buffer.from(sig);
    const expBuf = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length) {
      console.log("Signature length mismatch:", sigBuf.length, "vs", expBuf.length);
      return false;
    }

    const result = crypto.timingSafeEqual(expBuf, sigBuf);
    console.log("Signature match:", result);
    return result;
  } catch (err) {
    console.error("Signature verification error:", err.message);
    return false;
  }
}

const app = express();

app.use(bodyParser.json({
  type: "*/*",
  verify: (req, _res, buf) => { req.rawBody = buf; }
}));

app.get("/", (_req, res) => {
  res.status(200).send("✅ Webhook server is running");
});

app.post("/webhook", async (req, res) => {
  try {
    console.log("Webhook request received");
    console.log("rawBody present:", !!req.rawBody);
    console.log("rawBody length:", req.rawBody?.length);
    console.log("X-Hub-Signature-256:", req.get("X-Hub-Signature-256"));

    if (!verifySignature(req)) {
      console.log("Signature verification failed");
      return res.status(401).send("bad signature");
    }

    console.log("Signature verified");
    const event = req.header("X-GitHub-Event");

    if (event === "ping") return res.status(200).send("pong");

    if (event === "push") {
      const owner = req.body?.repository?.owner?.login;
      const repo = req.body?.repository?.name;

      if (!owner || !repo) return res.status(400).send("missing repo info");
      if (owner !== ORG) return res.status(200).send("ignored - not our org");
    } else if (event === "repository") {
      const action = req.body?.action;
      if (action !== "created") return res.status(200).send("ignored - not a creation");
    } else {
      return res.status(200).send("ignored - unsupported event");
    }

    const owner = req.body?.repository?.owner?.login;
    const repo = req.body?.repository?.name;

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

module.exports.handler = serverless(app);
