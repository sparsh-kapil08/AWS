#!/bin/bash
set -e

# ==============================================================================
# KhetVaani EC2 Builder Script (Template)
# Builds and pushes the KhetVaani container image to Amazon ECR.
# Ensure AWS credentials or IAM instance profile is attached before execution.
# ==============================================================================

# Required Environment Variables (or attach an IAM Role with ECR push permissions)
AWS_REGION="${AWS_REGION:-ap-south-1}"
AWS_ACCOUNT_ID="${AWS_ACCOUNT_ID:-<YOUR_AWS_ACCOUNT_ID>}"
S3_BUCKET_NAME="${S3_BUCKET_NAME:-<YOUR_AUDIO_BUCKET_NAME>}"

echo "Starting Docker build for KhetVaani..."

# Install Docker & Unzip
dnf install -y docker unzip
systemctl start docker
systemctl enable docker

# Create build workspace
mkdir -p /app-build
cd /app-build

# Download source package from S3
aws s3 cp "s3://${S3_BUCKET_NAME}/build/source.zip" source.zip
unzip -o source.zip

# Authenticate with Amazon ECR
aws ecr get-login-password --region "${AWS_REGION}" | docker login --username AWS --password-stdin "${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"

# Build & Push container
docker build -t "${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/khetvaani-api:latest" .
docker push "${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/khetvaani-api:latest"

echo "Build and push completed successfully."
