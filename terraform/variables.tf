variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
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