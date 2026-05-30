#!/bin/bash
# Phase 1: Deploy OIDC Provider and IAM Role
# Run this once to setup GitHub Actions authentication

set -e

AWS_ACCOUNT_ID="079446008233"
AWS_REGION="us-east-1"
GITHUB_ORG="remydlc"
GITHUB_REPO="resume"
GITHUB_BRANCH="main"

echo "🚀 Phase 1: Setting up GitHub OIDC + IAM Role"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Deploy CloudFormation stack
echo "📦 Deploying CloudFormation stack: github-oidc-stack"
aws cloudformation deploy \
  --template-file oidc-setup.yaml \
  --stack-name github-oidc-stack \
  --region "$AWS_REGION" \
  --parameter-overrides \
    GitHubOrg="$GITHUB_ORG" \
    GitHubRepo="$GITHUB_REPO" \
    GitHubBranch="$GITHUB_BRANCH" \
  --capabilities CAPABILITY_NAMED_IAM

echo ""
echo "✅ Phase 1 Complete!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Retrieve outputs
echo ""
echo "📋 Stack Outputs:"
aws cloudformation describe-stacks \
  --stack-name github-oidc-stack \
  --region "$AWS_REGION" \
  --query 'Stacks[0].Outputs[*].[OutputKey,OutputValue]' \
  --output table

echo ""
echo "✨ Next Steps:"
echo "  1. Review the stack outputs above"
echo "  2. Copy the CDKDeploymentRoleArn to your GitHub Actions workflow"
echo "  3. Proceed to Phase 2: CDK Project Initialization"
