const express = require("express");
const bodyParser = require("body-parser");

const ORG = "test3032001";
const CSLB_TOPIC = "cslb-id-2343";
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

const app = express();
app.use(bodyParser.json({ type: "*/*" }));

app.post("/webhook", async (req, res) => {
  const event = req.header("X-GitHub-Event");
  if (event !== "repository") return res.status(200).send("ignored");

  const action = req.body?.action;
  if (action !== "created") return res.status(200).send("ignored");

  const owner = req.body?.repository?.owner?.login;
  const repo  = req.body?.repository?.name;

  // only act on your org
  if (owner !== ORG) return res.status(200).send("ignored");

  // Get existing topics
  const getResp = await fetch(`https://api.github.com/repos/${owner}/${repo}/topics`, {
    headers: {
      "Accept": "application/vnd.github+json",
      "Authorization": `Bearer ${GITHUB_TOKEN}`,
      "X-GitHub-Api-Version": "2022-11-28"
    }
  });
  const getJson = await getResp.json();
  const topics = new Set(getJson.names || []);
  topics.add(CSLB_TOPIC);

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
