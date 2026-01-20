output "api_endpoint" {
  description = "API Gateway endpoint URL"
  value       = "${aws_apigatewayv2_stage.prod.invoke_url}"
}

output "webhook_url" {
  description = "Webhook URL for GitHub"
  value       = "${aws_apigatewayv2_stage.prod.invoke_url}/webhook"
}

output "lambda_function_name" {
  description = "Lambda function name"
  value       = aws_lambda_function.webhook.function_name
}
output "note" {
  description = "Important: HTTP API v2 routes do NOT include the stage name in the path"
  value       = "Routes are GET /, POST /webhook, GET /webhook (not /prod/webhook)"
}