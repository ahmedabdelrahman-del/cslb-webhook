/* eslint-disable no-console */
const crypto = require("crypto");

// Adjust the require path if you move this script
const { handler } = require("../lambda");

// Stub fetch to avoid real network calls during smoke tests
global.fetch = async () => ({
  ok: true,
  status: 200,
  json: async () => ({ names: [] }),
  text: async () => "",
});

function sign(secret, bodyBuf) {
  const h = crypto.createHmac("sha256", secret).update(bodyBuf).digest("hex");
  return `sha256=${h}`;
}

async function runCase(name, { secret, body, isBase64Encoded, tamperSig, githubEvent = "ping" }) {
  process.env.WEBHOOK_SECRET = secret;
  process.env.GITHUB_TOKEN = "dummy"; // not used by ping route, but avoids missing var errors

  const bodyBuf = Buffer.from(body, "utf8");
  const sig = sign(secret, bodyBuf);
  const sigToSend = tamperSig ? sig.replace(/.$/, sig.endsWith("0") ? "1" : "0") : sig;

  const event = {
    version: "2.0",
    routeKey: "POST /webhook",
    rawPath: "/webhook",
    rawQueryString: "",
    requestContext: {
      http: {
        method: "POST",
        path: "/webhook",
      },
    },
    headers: {
      "x-hub-signature-256": sigToSend,
      "x-github-event": githubEvent,
      "content-type": "application/json",
    },
    isBase64Encoded: !!isBase64Encoded,
    body: isBase64Encoded ? bodyBuf.toString("base64") : body,
  };

  const resp = await handler(event, {});
  console.log(`\n=== ${name} ===`);
  console.log("statusCode:", resp.statusCode);
  console.log("body:", resp.body);
}

(async () => {
  const secret = "testsecret";
  const body = JSON.stringify({ zen: "Keep it logically awesome.", hook_id: 123 });
  const pushBody = JSON.stringify({
    ref: "refs/heads/main",
    repository: {
      name: "demo-repo",
      full_name: "test3032001/demo-repo",
      owner: { login: "test3032001" },
    },
  });

  await runCase("valid signature, plain", {
    secret,
    body,
    isBase64Encoded: false,
    tamperSig: false,
  });

  await runCase("invalid signature, plain", {
    secret,
    body,
    isBase64Encoded: false,
    tamperSig: true,
  });

  await runCase("valid signature, base64", {
    secret,
    body,
    isBase64Encoded: true,
    tamperSig: false,
  });

  await runCase("invalid signature, base64", {
    secret,
    body,
    isBase64Encoded: true,
    tamperSig: true,
  });

  await runCase("valid signature, push (plain)", {
    secret,
    body: pushBody,
    isBase64Encoded: false,
    tamperSig: false,
    githubEvent: "push",
  });
})();
