# 🚀 KhetVaani AWS Deployment Guide (ap-south-1)

This guide documents the complete infrastructure deployment process for **KhetVaani** using AWS CDK.

---

## 🏗️ Architecture Summary

| Component | AWS Resource | Details |
|---|---|---|
| **API & Web App** | AWS App Runner | Express Container, VPC Connector to private RDS, port 3000 |
| **Database** | RDS PostgreSQL 16.3 + PostGIS | `db.t4g.micro`, 20GB GP3, isolated private subnets |
| **Secrets** | AWS Secrets Manager | Auto-generated RDS password (`khetvaani/rds/postgres`) |
| **Media Storage** | Amazon S3 | Private bucket for audio clips, crop photos |
| **Scheduler** | EventBridge + AWS Lambda | Daily 05:00 IST forecast & El Niño analysis job |
| **Container Registry** | Amazon ECR | Docker repository `khetvaani-api` with 10-image lifecycle |
| **Networking** | Amazon VPC (ap-south-1) | 2 AZs, public/private/isolated subnets, 1 NAT Gateway |

---

## 💰 Resource Cost Estimates (ap-south-1 Mumbai)

| Resource | Configuration | Estimated Monthly Cost |
|---|---|---|
| **VPC NAT Gateway** | 1 NAT Gateway + 5GB data processing | ~$33.00 / month |
| **RDS PostgreSQL** | `db.t4g.micro` + 20GB GP3 storage | ~$15.80 / month |
| **App Runner** | 1 vCPU / 2GB RAM (baseline + light traffic) | ~$12.00 / month |
| **Amazon S3** | Standard Storage (< 10GB audio & photos) | ~$0.25 / month |
| **Secrets Manager** | 1 Secret (`khetvaani/rds/postgres`) | ~$0.40 / month |
| **AWS Lambda** | 512MB, 1 run/day (~30 executions/month) | Free Tier ($0.00) |
| **EventBridge Rule** | Scheduled rule | Free Tier ($0.00) |
| **Amazon ECR** | Container image storage (< 2GB) | ~$0.20 / month |
| **Total Baseline** | | **~$61.65 / month** |

---

## 📋 Step-by-Step Deployment Commands

### Step 1: Install CDK Dependencies
```bash
cd infra
npm install
npm run build
```

### Step 2: Bootstrap CDK Environment (One-time per AWS account)
```bash
npx cdk bootstrap aws://<YOUR_AWS_ACCOUNT_ID>/ap-south-1
```

### Step 3: Inspect Infrastructure (Synth & Diff)
```bash
npx cdk synth
npx cdk diff
```

### Step 4: Deploy Stack (⚠️ Require User Approval Before Running)
```bash
npx cdk deploy --require-approval never
```

### Step 5: Build & Push Container Image to ECR
```bash
# Authenticate Docker to ECR
aws ecr get-login-password --region ap-south-1 | docker login --username AWS --password-stdin <YOUR_AWS_ACCOUNT_ID>.dkr.ecr.ap-south-1.amazonaws.com

# Build production container image
docker build -t khetvaani-api ..

# Tag and push image
docker tag khetvaani-api:latest <YOUR_AWS_ACCOUNT_ID>.dkr.ecr.ap-south-1.amazonaws.com/khetvaani-api:latest
docker push <YOUR_AWS_ACCOUNT_ID>.dkr.ecr.ap-south-1.amazonaws.com/khetvaani-api:latest
```

### Step 6: Run PostGIS Database Migration
```bash
# Retrieve Database connection parameters from Secrets Manager & SSM
DATABASE_URL="postgres://khetvaani_admin:<PASSWORD>@<DB_ENDPOINT>:5432/khetvaani" node ../scripts/migrate.js
```

---

## 🧪 Post-Deployment Integration Verification

Run the Phase 3 live workflow test against the deployed public URL:
```bash
# Verify health endpoint
curl https://<APP_RUNNER_SERVICE_URL>/health

# Run automated end-to-end integration test
DEPLOYED_API_URL=https://<APP_RUNNER_SERVICE_URL> npx vitest run tests/phase6.test.js
```

---

## 🛑 Teardown & Clean Up

To avoid ongoing charges and completely destroy all AWS resources created by the stack:
```bash
cd infra
npx cdk destroy --force
```
*(Note: S3 audio clips and ECR image repositories have retention policies set to prevent accidental loss; delete them manually via AWS Console or AWS CLI if full purge is desired).*
