# Resume Infrastructure Setup Guide

This guide walks through deploying the Cloud Resume Challenge infrastructure using AWS CDK, GitHub Actions, and Go Lambda functions.

## Prerequisites

- AWS Account with appropriate permissions
- AWS CLI v2 configured with credentials
- Node.js 18+ and npm
- Go 1.21+
- GitHub account with repository access

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         Route 53                                 │
│                    nine3one2.com (DNS)                          │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ↓
        ┌──────────────────────────────────────┐
        │      CloudFront Distribution          │
        │   (Cache, HTTPS, OAC Security)        │
        └──────────┬───────────────────────────┘
                   │
        ┌──────────┴──────────────────┐
        ↓                             ↓
┌──────────────────┐      ┌──────────────────────┐
│   S3 Bucket      │      │   API Gateway        │
│ (Frontend HTML)  │      │  (HTTP API)          │
└──────────────────┘      │                      │
                          │  /counter (GET)      │
                          └──────────┬───────────┘
                                     ↓
                          ┌──────────────────────┐
                          │  Lambda (Go)         │
                          │  UpdateItem Logic    │
                          └──────────┬───────────┘
                                     ↓
                          ┌──────────────────────┐
                          │   DynamoDB Table     │
                          │ ResumeVisitorCounter │
                          └──────────────────────┘
```

## Phase 1: OIDC Authentication & IAM (One-time Setup)

This phase establishes secure GitHub Actions authentication without long-lived AWS keys.

### Step 1.1: Deploy OIDC Provider and IAM Role

```bash
cd resume/
chmod +x PHASE1-SETUP.sh
./PHASE1-SETUP.sh
```

**What this does:**
- Creates an OIDC Identity Provider for GitHub Actions
- Creates an IAM role (`GitHubActionsCDKDeployRole`) with admin permissions
- Outputs the role ARN for use in GitHub Actions

**Expected Output:**
```
✅ Phase 1 Complete!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📋 Stack Outputs:
| OIDCProviderArn           | arn:aws:iam::079446008233:oidc-provider/... |
| CDKDeploymentRoleArn      | arn:aws:iam::079446008233:role/GitHubActions... |
| CDKDeploymentRoleName     | GitHubActionsCDKDeployRole |
```

**Save the `CDKDeploymentRoleArn`** – you'll need it for the GitHub Actions workflow.

### Step 1.2: Add IAM Role to GitHub Secrets (Manual)

After Phase 1 completes, add the role ARN to GitHub:

1. Go to https://github.com/remydlc/resume/settings/secrets/actions
2. Create a new repository secret:
   - **Name:** `AWS_ROLE_ARN`
   - **Value:** `arn:aws:iam::079446008233:role/GitHubActionsCDKDeployRole` (from above)

---

## Phase 2: CDK Project Initialization & Storage Layer

This phase initializes the AWS CDK project and creates DynamoDB + S3.

### Step 2.1: Install Dependencies

```bash
cd resume/
npm install
```

This installs AWS CDK and TypeScript dependencies.

### Step 2.2: Bootstrap CDK Environment (First time only)

```bash
npm run cdk -- bootstrap aws://079446008233/us-east-1
```

This creates a CloudFormation stack in your AWS account to support CDK deployments.

### Step 2.3: Synthesize and Deploy

```bash
npm run cdk:synth
npm run cdk:deploy
```

**Expected Outputs:**

After deployment, you'll see:
```
Outputs:
DynamoDBTableName = ResumeVisitorCounter
DynamoDBTableArn = arn:aws:dynamodb:us-east-1:079446008233:table/ResumeVisitorCounter
FrontendBucketName = resume.nine3one2.com
FrontendBucketArn = arn:aws:s3:::resume.nine3one2.com
HostedZoneId = Z1234567890ABC
```

**What was created:**
- ✅ DynamoDB table `ResumeVisitorCounter` with partition key `id` (String)
- ✅ S3 bucket `resume.nine3one2.com` (fully private, no public access)
- ✅ Route 53 hosted zone lookup for `nine3one2.com`

---

## Phase 3: Compute & API Layer (Go Lambda + API Gateway)

### Step 3.1: Build Go Lambda Function

```bash
cd resume/src/backend/counter/
go mod tidy
go build -o bootstrap main.go
```

This compiles the Go Lambda function into a `bootstrap` binary (required for `provided.al2023` runtime).

### Step 3.2: Update CDK Stack (Coming Next)

The CDK stack will be updated to include:
- Lambda function configuration (Go runtime)
- IAM permissions for DynamoDB access
- HTTP API Gateway with CORS headers

---

## Phase 4: Edge Routing & Security (CloudFront + ACM + Route 53)

This phase adds:
- ACM certificate for `resume.nine3one2.com`
- CloudFront distribution with OAC (Origin Access Control)
- S3 bucket policy restricting access to CloudFront only
- Route 53 A/AAAA record pointing to CloudFront

---

## Phase 5: GitHub Actions Deployment Pipeline

The `.github/workflows/deploy.yml` file will:

1. **Setup** Node.js and Go toolchains
2. **Authenticate** to AWS via OIDC (no long-lived keys!)
3. **Deploy** infrastructure with `cdk deploy`
4. **Update Frontend** with API endpoint URL
5. **Upload** HTML to S3 and invalidate CloudFront cache

---

## File Structure

```
resume/
├── bin/
│   └── resume.ts                    # CDK app entry point
├── lib/
│   └── resume-stack.ts              # Main CDK stack
├── src/
│   ├── backend/
│   │   └── counter/
│   │       ├── main.go              # Go Lambda handler
│   │       ├── go.mod               # Go module definition
│   │       └── bootstrap             # Compiled binary (after build)
│   └── frontend/
│       └── index.html               # Resume webpage
├── .github/
│   └── workflows/
│       └── deploy.yml               # GitHub Actions pipeline
├── package.json                     # Node.js dependencies
├── tsconfig.json                    # TypeScript config
├── cdk.json                         # CDK config
├── .gitignore                       # Git ignore rules
├── oidc-setup.yaml                  # CloudFormation template for Phase 1
└── SETUP_GUIDE.md                   # This file
```

---

## Debugging & Troubleshooting

### CDK Deploy Fails

```bash
# Check CloudFormation events
aws cloudformation describe-stack-events --stack-name ResumeStack --region us-east-1

# View detailed CDK logs
cdk deploy --debug
```

### Lambda Function Build Issues

```bash
# Verify Go dependencies
cd src/backend/counter/
go mod download
go mod verify

# Test local binary
go run main.go
```

### DynamoDB Not Accessible

Check Lambda IAM permissions:
```bash
aws iam get-role-policy --role-name <lambda-execution-role> --policy-name <policy-name>
```

---

## Security Checklist

- ✅ S3 bucket has all public access blocked
- ✅ DynamoDB encrypted at rest
- ✅ Lambda executes with minimal IAM permissions
- ✅ API Gateway CORS restricts to `resume.nine3one2.com`
- ✅ CloudFront uses OAC for S3 access control
- ✅ GitHub Actions uses OIDC (no long-lived keys)

---

## Cost Estimation (Monthly, US East 1)

- **DynamoDB:** ~$0.25 (on-demand, ~1000 reads/writes)
- **S3:** ~$1 (storage + CloudFront transfers)
- **Lambda:** ~$0.20 (1M invocations free tier)
- **CloudFront:** ~$0.50 (data transfer)
- **API Gateway:** ~$0.50
- **Route 53:** $0.50 (hosted zone)

**Total:** ~$3.95/month

---

## Next Steps

1. ✅ Phase 1: Run `./PHASE1-SETUP.sh`
2. ✅ Phase 2: Run `npm install && npm run cdk:deploy`
3. 🔄 Phase 3: Compile Go Lambda (`go build`)
4. ⏳ Phase 4: Add CloudFront + ACM
5. ⏳ Phase 5: Create GitHub Actions workflow

---

For questions or issues, refer to the AWS CDK documentation:
https://docs.aws.amazon.com/cdk/v2/guide/
