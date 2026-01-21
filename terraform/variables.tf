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
variable "layer_s3_bucket" {
  description = "S3 bucket that contains lambda layer zip"
  type        = string
}

variable "layer_s3_key" {
  description = "S3 key for lambda layer zip"
  type        = string
}

variable "layer_hash" {
  description = "Base64-encoded SHA256 of the layer zip (for updates)"
  type        = string
}