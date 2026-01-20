terraform {
  required_version = ">= 1.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

# IAM Role for Lambda execution
resource "aws_iam_role" "lambda_role" {
  name = "cslb-webhook-lambda-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
      }
    ]
  })
}

# IAM Policy for CloudWatch Logs
resource "aws_iam_role_policy_attachment" "lambda_logs" {
  role       = aws_iam_role.lambda_role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# Secrets Manager for GitHub Token
resource "aws_secretsmanager_secret" "github_token" {
  name                    = "cslb-webhook/github-token"
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret_version" "github_token" {
  secret_id     = aws_secretsmanager_secret.github_token.id
  secret_string = var.github_token
}

# IAM Policy for Lambda to read secrets
resource "aws_iam_role_policy" "lambda_secrets" {
  name = "lambda-secrets-policy"
  role = aws_iam_role.lambda_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue"
        ]
        Resource = aws_secretsmanager_secret.github_token.arn
      }
    ]
  })
}

# Lambda Layer with dependencies
data "archive_file" "dependencies" {
  type        = "zip"
  source_dir  = "${path.module}/../node_modules"
  output_path = "${path.module}/../.terraform/node_modules.zip"
}

resource "aws_lambda_layer_version" "dependencies" {
  filename   = data.archive_file.dependencies.output_path
  layer_name = "cslb-webhook-dependencies"

  source_code_hash = data.archive_file.dependencies.output_base64sha256

  compatible_runtimes = ["nodejs20.x"]
}

# Lambda Function
data "archive_file" "lambda" {
  type        = "zip"
  source_file = "${path.module}/../lambda.js"
  output_path = "${path.module}/../.terraform/lambda.zip"
}

resource "aws_lambda_function" "webhook" {
  filename      = data.archive_file.lambda.output_path
  function_name = "cslb-webhook"
  role          = aws_iam_role.lambda_role.arn
  handler       = "lambda.handler"
  runtime       = "nodejs20.x"
  timeout       = 30

  source_code_hash = data.archive_file.lambda.output_base64sha256

  layers = [aws_lambda_layer_version.dependencies.arn]

  environment {
    variables = {
      GITHUB_TOKEN = var.github_token
    }
  }

  depends_on = [aws_iam_role_policy_attachment.lambda_logs]
}

# API Gateway
resource "aws_apigatewayv2_api" "webhook" {
  name          = "cslb-webhook-api"
  protocol_type = "HTTP"

  cors_configuration {
    allow_origins = ["*"]
    allow_methods = ["GET", "POST", "OPTIONS"]
    allow_headers = ["*"]
  }
}

# Lambda Integration
resource "aws_apigatewayv2_integration" "lambda" {
  api_id             = aws_apigatewayv2_api.webhook.id
  integration_type   = "AWS_PROXY"
  integration_method = "POST"
  target             = "arn:aws:apigatewayv2:${var.aws_region}:lambda:path/2015-03-31/functions/${aws_lambda_function.webhook.arn}/invocations"
  payload_format_version = "2.0"
}

# Routes
resource "aws_apigatewayv2_route" "root" {
  api_id             = aws_apigatewayv2_api.webhook.id
  route_key          = "GET /"
  target             = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

resource "aws_apigatewayv2_route" "webhook" {
  api_id             = aws_apigatewayv2_api.webhook.id
  route_key          = "POST /webhook"
  target             = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

resource "aws_apigatewayv2_route" "webhook_get" {
  api_id             = aws_apigatewayv2_api.webhook.id
  route_key          = "GET /webhook"
  target             = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

# Stage
resource "aws_apigatewayv2_stage" "prod" {
  api_id      = aws_apigatewayv2_api.webhook.id
  name        = "prod"
  auto_deploy = true

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.api_logs.arn
    format = jsonencode({
      requestId      = "$context.requestId"
      ip             = "$context.identity.sourceIp"
      requestTime    = "$context.requestTime"
      httpMethod     = "$context.httpMethod"
      routeKey       = "$context.routeKey"
      status         = "$context.status"
      protocol       = "$context.protocol"
      responseLength = "$context.responseLength"
      integrationLatency = "$context.integration.latency"
    })
  }
}

# CloudWatch Logs
resource "aws_cloudwatch_log_group" "api_logs" {
  name              = "/aws/apigateway/cslb-webhook"
  retention_in_days = 7
}

resource "aws_cloudwatch_log_group" "lambda_logs" {
  name              = "/aws/lambda/cslb-webhook"
  retention_in_days = 7
}

# Lambda permission for API Gateway
resource "aws_lambda_permission" "api_gateway" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.webhook.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.webhook.execution_arn}/*/*"
}
