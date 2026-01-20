# cslb-webhook

Webhook service that ensures all repositories in the `test3032001` org have the topic `cslb-id-2343`. Supports GitHub webhook events: `ping`, `push`, and `repository` (created).

## Local Development

1. Set your GitHub token (must include `repo` scope for private repos):

```bash
export GITHUB_TOKEN=ghp_your_token_here
```

2. Install dependencies:

```bash
npm install
```

3. Start the server:

```bash
node server.js
```

The server listens on `0.0.0.0:3000`:
- Health: `GET /` → `✅ Webhook server is running`
- Webhook: `POST /webhook`

## Production Deployment (AWS Lambda)

### Prerequisites

- AWS account with credentials configured
- Terraform installed locally
- GitHub Actions enabled on this repo

### Step 1: Create AWS IAM Role for GitHub Actions (OIDC)

```bash
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1 \
  --client-id-list sts.amazonaws.com
```

Then create an IAM role that allows GitHub Actions to assume it. Save the role ARN.

### Step 2: Add GitHub Secrets

1. Go to your repo → **Settings** → **Secrets and variables** → **Actions**
2. Add:
   - `AWS_ROLE_ARN`: The role ARN from Step 1
   - `GITHUB_TOKEN`: Your GitHub personal access token (used by the webhook)

### Step 3: Deploy via GitHub Actions

Push to `main` branch:

```bash
git add .
git commit -m "Deploy to AWS Lambda"
git push origin main
```

GitHub Actions will automatically:
- Build the Lambda function
- Run Terraform to deploy to AWS
- Output your webhook URL

### Step 4: Configure GitHub Webhook

1. Go to: `https://github.com/organizations/test3032001/settings/hooks`
2. Add a new webhook:
   - **Payload URL**: Use the output from GitHub Actions (e.g., `https://xxx.execute-api.us-east-1.amazonaws.com/prod/webhook`)
   - **Content type**: `application/json`
   - **Events**: Select "Let me select individual events" → Check `Pushes` and `Repositories`
3. Save

### Manual Deployment (Alternative)

If you prefer manual deployment:

```bash
cd terraform
terraform init
terraform apply \
  -var="github_token=$GITHUB_TOKEN"
```

Copy the `webhook_url` output and configure it in GitHub.

## Architecture

- **AWS Lambda**: Serverless function (Node.js 20)
- **API Gateway**: Public HTTPS endpoint
- **CloudWatch Logs**: Structured logging
- **Secrets Manager**: Stores GitHub token securely

## Cost

- ~$2-5/month (scales to zero when idle)
- Free tier covers most usage

## Monitoring

View logs in CloudWatch:

```bash
aws logs tail /aws/lambda/cslb-webhook --follow
```

## Notes

- Do not commit secrets. Use environment variables and AWS Secrets Manager.
- GitHub token must have `repo` scope to access private repositories.
- Lambda has 30-second timeout; sufficient for webhook processing.
