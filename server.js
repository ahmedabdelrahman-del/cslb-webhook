const express = require("express");
const bodyParser = require("body-parser");

const ORG = "test3032001";
const CSLB_TOPIC = "cslb-id-2343";
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

const app = express();
app.use(bodyParser.json({ type: "*/*" }));

app.get("/", (req, res) => {
  res.status(200).send("✅ Webhook server is running");
});

app.post("/webhook", async (req, res) => {
  const event = req.header("X-GitHub-Event");
  
  // Handle ping events (webhook test)
  if (event === "ping") {
    return res.status(200).send("pong");
  }
  
  // Handle push events
  if (event === "push") {
    const owner = req.body?.repository?.owner?.login;
    const repo  = req.body?.repository?.name;
    
    if (!owner || !repo) return res.status(400).send("missing repo info");
    
    // only act on your org
    if (owner !== ORG) return res.status(200).send("ignored - not our org");
  }
  // Handle repository creation events
  else if (event === "repository") {
    const action = req.body?.action;
    if (action !== "created") return res.status(200).send("ignored - not a creation");
  } else {
    return res.status(200).send("ignored - unsupported event");
  }

  const owner = req.body?.repository?.owner?.login;
  const repo  = req.body?.repository?.name;

  // only act on your org
  if (owner !== ORG) return res.status(200).send("ignored");

  console.log(`Processing webhook for ${owner}/${repo}`);

  // Get existing topics
  const getResp = await fetch(`https://api.github.com/repos/${owner}/${repo}/topics`, {
    headers: {
      "Accept": "application/vnd.github+json",
      "Authorization": `Bearer ${GITHUB_TOKEN}`,
      "X-GitHub-Api-Version": "2022-11-28"
    }
  });
  const getJson = await getResp.json();
  
  if (!getResp.ok) {
    console.error("Failed to get topics:", getResp.status, getJson);
    return res.status(500).send("failed to get topics");
  }
  
  const topics = new Set(getJson.names || []);
  topics.add(CSLB_TOPIC);

  console.log(`Adding topic ${CSLB_TOPIC} to ${owner}/${repo}. Current topics:`, Array.from(topics));

  // Replace all topics (adds CSLB without deleting existing ones)
  const putResp = await fetch(`https://api.github.com/repos/${owner}/${repo}/topics`, {
    method: "PUT",
    headers: {
      "Accept": "application/vnd.github+json",
      "Authorization": `Bearer ${GITHUB_TOKEN}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ names: Array.from(topics) })
  });

  if (!putResp.ok) {
    const txt = await putResp.text();
    console.error("Failed to set topics:", putResp.status, txt);
    return res.status(500).send("failed");
  }

  console.log(`✅ Added ${CSLB_TOPIC} to ${owner}/${repo}`);
  res.status(200).send("ok");
});

app.listen(3000, () => console.log("Listening on http://localhost:3000/webhook"));
