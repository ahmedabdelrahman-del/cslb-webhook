# CSLB Webhook

A serverless GitHub webhook that automatically tags all repositories in the `test3032001` organization with the topic `cslb-id-2343`.

## 🎯 What It Does

When a repository is **created** or receives a **push** in the `test3032001` organization, this webhook automatically adds the `cslb-id-2343` topic to that repository. This ensures consistent tagging across all org repos without manual intervention.

## 🏗️ Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  GitHub Webhook │────▶│  API Gateway v2  │────▶│  AWS Lambda     │
│  (Org Events)   │     │  (HTTP API)      │     │  (Node.js 20)   │
└─────────────────┘     └──────────────────┘     └─────────────────┘
                                                          │
                                                          ▼
                                                 ┌─────────────────┐
                                                 │  GitHub API     │
                                                 │  (Set Topics)   │
                                                 └─────────────────┘
```

### Components

| Component | Description |
|-----------|-------------|
| **AWS Lambda** | Runs the webhook handler (Node.js 20, 128MB, 30s timeout) |
| **API Gateway v2** | HTTP API endpoint that receives GitHub webhooks |
| **Lambda Layer** | Contains npm dependencies (Express, serverless-http) |
| **Terraform** | Infrastructure as Code for all AWS resources |
| **GitHub Actions** | CI/CD pipeline for automated deployments |

## 🔐 Security

### 1. Webhook Signature Verification (HMAC SHA-256)

Every incoming webhook request is verified using GitHub's signature mechanism:

```javascript
// GitHub signs each payload with your secret
X-Hub-Signature-256: sha256=<HMAC-SHA256-signature>

// We verify by computing our own signature and comparing
const hmac = crypto.createHmac("sha256", WEBHOOK_SECRET)
  .update(rawBody)
  .digest("hex");
const expected = `sha256=${hmac}`;

// Timing-safe comparison prevents timing attacks
crypto.timingSafeEqual(expectedBuffer, signatureBuffer);
```

**Why this matters:**
- Prevents spoofed requests - only GitHub can produce valid signatures
- Uses constant-time comparison to prevent timing attacks
- Rejects requests without valid signatures with 401

### 2. GitHub Token (Classic PAT)

The webhook uses a GitHub Personal Access Token with `repo` scope to:
- Read existing repository topics
- Write/update repository topics

**Token requirements:**
- Must have `repo` scope (for private repos) or `public_repo` (public only)
- Stored as Lambda environment variable
- Never logged or exposed in responses

### 3. Request Validation

The webhook validates:
- ✅ Signature is present and valid
- ✅ Event type is supported (`ping`, `push`, `repository`)
- ✅ Repository belongs to the target organization
- ✅ For `repository` events, action must be `created`

### 4. Infrastructure Security

| Layer | Security Measure |
|-------|------------------|
| **API Gateway** | HTTPS only, no authentication (GitHub handles via signature) |
| **Lambda** | Minimal IAM permissions, environment variables for secrets |
| **Logs** | CloudWatch with 7-day retention, no sensitive data logged |

## 📁 Project Structure

```
cslb-webhook/
├── lambda.js              # Main Lambda handler
├── server.js              # Local development server
├── package.json           # Dependencies
├── terraform/
│   ├── main.tf            # AWS infrastructure
│   ├── variables.tf       # Input variables
│   ├── outputs.tf         # Output values
│   └── lambda_layer.zip   # Packaged dependencies
└── .github/
    └── workflows/
        └── deploy.yml     # CI/CD pipeline
```

## 🔄 How It Works (Flow)

```
1. User creates repo in test3032001 org
         │
         ▼
2. GitHub sends POST to /webhook with:
   - X-Hub-Signature-256 header (HMAC signature)
   - X-GitHub-Event: repository
   - JSON body with repo details
         │
         ▼
3. Lambda verifies signature
   (HMAC-SHA256 with shared secret)
         │
         ▼
4. Lambda checks:
   - Is this our org? (test3032001)
   - Is this a creation event?
         │
         ▼
5. Lambda calls GitHub API:
   - GET /repos/{owner}/{repo}/topics
   - Adds cslb-id-2343 to existing topics
   - PUT /repos/{owner}/{repo}/topics
         │
         ▼
6. Returns 200 OK
```

## 🚀 Deployment

### Prerequisites

- AWS account with credentials configured
- Terraform >= 1.0
- Node.js 20.x
- GitHub Classic PAT with `repo` scope

### Manual Deployment

1. **Create the Lambda Layer:**
   ```bash
   cd terraform
   mkdir -p layer/nodejs
   cd layer/nodejs
   npm init -y
   npm install express body-parser serverless-http
   cd ..
   zip -r ../lambda_layer.zip nodejs
   cd ..
   ```

2. **Deploy with Terraform:**
   ```bash
   cd terraform
   terraform init
   terraform apply \
     -var="github_token=ghp_your_token" \
     -var="webhook_secret=your_webhook_secret"
   ```

3. **Configure GitHub Webhook:**
   - Go to `https://github.com/organizations/test3032001/settings/hooks`
   - Add webhook with:
     - **Payload URL:** `https://<api-id>.execute-api.us-east-1.amazonaws.com/prod/webhook`
     - **Content type:** `application/json`
     - **Secret:** Same as `webhook_secret` above
     - **Events:** `Pushes` and `Repositories`

### CI/CD Deployment (GitHub Actions)

Push to `main` branch triggers automatic deployment:

1. Builds Lambda layer with dependencies
2. Runs `terraform apply` with secrets from GitHub Actions
3. Updates Lambda function code

**Required GitHub Secrets:**

| Secret | Description |
|--------|-------------|
| `AWS_ROLE_ARN` | IAM role ARN for OIDC authentication |
| `GITHUB_TOKEN_WEBHOOK` | GitHub PAT for API calls |
| `WEBHOOK_SECRET` | Shared secret for signature verification |

## 🧪 Local Development

```bash
# Set environment variables
export GITHUB_TOKEN=ghp_your_token
export WEBHOOK_SECRET=your_secret

# Install dependencies
npm install

# Run local server
node server.js
# Server runs on http://localhost:3000
```

Test with curl:
```bash
curl -X POST http://localhost:3000/webhook \
  -H "Content-Type: application/json" \
  -H "X-GitHub-Event: ping" \
  -d '{}'
```

## 📊 Monitoring

### CloudWatch Logs

View Lambda logs:
```bash
aws logs tail /aws/lambda/cslb-webhook --follow --region us-east-1
```

### Successful Request Log:
```
Lambda event body captured: 6677 bytes
Webhook request received
Signature match: true
Signature verified
Processing webhook for test3032001/my-repo
Adding topic cslb-id-2343 to test3032001/my-repo
✅ Added cslb-id-2343 to test3032001/my-repo
```

## 💰 Cost Estimate

| Resource | Monthly Cost |
|----------|--------------|
| Lambda (1000 invocations) | ~$0.01 |
| API Gateway (1000 requests) | ~$0.01 |
| CloudWatch Logs | ~$0.50 |
| **Total** | **~$0.50 - $2/month** |

## 🛠️ Troubleshooting

| Issue | Solution |
|-------|----------|
| `401 bad signature` | Check WEBHOOK_SECRET matches GitHub webhook config |
| `401 Bad credentials` | GitHub token is invalid or expired |
| `403 Resource not accessible` | Token missing `repo` scope - use Classic PAT |
| `Cannot POST /prod/webhook` | Check API Gateway routes are deployed |

## 📝 Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GITHUB_TOKEN` | Yes | GitHub PAT with `repo` scope |
| `WEBHOOK_SECRET` | Yes | Shared secret for webhook signature |

## 📜 License

MIT
