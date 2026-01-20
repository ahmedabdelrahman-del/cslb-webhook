terraform {
  required_version = ">= 1.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

data "aws_iam_role" "lambda_role" {
  name = "cslb-webhook-lambda-role"
}

resource "aws_iam_role_policy_attachment" "lambda_logs" {
  role       = data.aws_iam_role.lambda_role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

data "aws_secretsmanager_secret" "github_token" {
  name = "cslb-webhook/github-token"
}

resource "aws_secretsmanager_secret_version" "github_token" {
  secret_id     = data.aws_secretsmanager_secret.github_token.id
  secret_string = var.github_token
}

resource "aws_iam_role_policy" "lambda_secrets" {
  name = "lambda-secrets-policy"
  role = data.aws_iam_role.lambda_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = data.aws_secretsmanager_secret.github_token.arn
      }
    ]
  })
}

resource "aws_lambda_layer_version" "dependencies" {
  filename            = "${path.module}/lambda_layer.zip"
  layer_name          = "cslb-webhook-dependencies"
  compatible_runtimes = ["nodejs20.x"]
}

data "archive_file" "lambda" {
  type        = "zip"
  source_file = "${path.module}/../lambda.js"
  output_path = "${path.module}/../build/lambda.zip"
}

resource "aws_lambda_function" "webhook" {
  filename      = data.archive_file.lambda.output_path
  function_name = "cslb-webhook"
  role          = data.aws_iam_role.lambda_role.arn
  handler       = "lambda.handler"
  runtime       = "nodejs20.x"
  timeout       = 30

  source_code_hash = data.archive_file.lambda.output_base64sha256

  layers = [aws_lambda_layer_version.dependencies.arn]

  environment {
    variables = {
      GITHUB_TOKEN   = var.github_token
      WEBHOOK_SECRET = var.webhook_secret
    }
  }

  depends_on = [
    aws_iam_role_policy_attachment.lambda_logs,
    aws_iam_role_policy.lambda_secrets
  ]
}

resource "aws_apigatewayv2_api" "webhook" {
  name          = "cslb-webhook-api"
  protocol_type = "HTTP"

  cors_configuration {
    allow_origins = ["*"]
    allow_methods = ["GET", "POST", "OPTIONS"]
    allow_headers = ["*"]
  }
}

resource "aws_apigatewayv2_integration" "lambda" {
  api_id                 = aws_apigatewayv2_api.webhook.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.webhook.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "root" {
  api_id    = aws_apigatewayv2_api.webhook.id
  route_key = "GET /"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

resource "aws_apigatewayv2_route" "webhook" {
  api_id    = aws_apigatewayv2_api.webhook.id
  route_key = "POST /webhook"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

resource "aws_apigatewayv2_route" "webhook_get" {
  api_id    = aws_apigatewayv2_api.webhook.id
  route_key = "GET /webhook"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

resource "aws_cloudwatch_log_group" "api_logs" {
  name              = "/aws/apigateway/cslb-webhook"
  retention_in_days = 7
}

resource "aws_cloudwatch_log_group" "lambda_logs" {
  name              = "/aws/lambda/cslb-webhook"
  retention_in_days = 7
}

resource "aws_apigatewayv2_stage" "prod" {
  api_id      = aws_apigatewayv2_api.webhook.id
  name        = "prod"
  auto_deploy = true

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.api_logs.arn
    format = jsonencode({
      requestId          = "$context.requestId"
      ip                 = "$context.identity.sourceIp"
      requestTime        = "$context.requestTime"
      httpMethod         = "$context.httpMethod"
      routeKey           = "$context.routeKey"
      status             = "$context.status"
      protocol           = "$context.protocol"
      responseLength     = "$context.responseLength"
      integrationLatency = "$context.integration.latency"
    })
  }
}

resource "aws_lambda_permission" "api_gateway" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.webhook.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.webhook.execution_arn}/*/*"
}
variable "aws_region" {
  default = "us-east-1"
}

variable "github_token" {
  description = "GitHub personal access token"
  type        = string
  sensitive   = true
}

variable "webhook_secret" {
  description = "Webhook secret for GitHub signature validation"
  type        = string
  sensitive   = true
}