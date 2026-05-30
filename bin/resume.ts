#!/usr/bin/env ts-node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { ResumeStack } from '../lib/resume-stack';

const app = new cdk.App();

new ResumeStack(app, 'ResumeStack', {
  env: {
    account: '079446008233',
    region: 'us-east-1',
  },
  description: 'Cloud Resume Infrastructure: S3 + CloudFront + DynamoDB + Lambda API',
});

app.synth();
