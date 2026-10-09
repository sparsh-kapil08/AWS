#!/usr/bin/env node
import { App } from 'aws-cdk-lib';
import { KhetvaaniStack } from '../lib/khetvaani-stack';

const app = new App();

// Optional feature flags from CDK context
const enableCloudFront = app.node.tryGetContext('enableCloudFront') === 'true' || false;
const enableSns = app.node.tryGetContext('enableSns') === 'true' || false;
const enableLocation = app.node.tryGetContext('enableLocation') === 'true' || false;

new KhetvaaniStack(app, 'KhetvaaniStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'ap-south-1',
  },
  description: 'KhetVaani Agronomy & Voice Advisory Platform Stack (ap-south-1)',
  enableCloudFront,
  enableSns,
  enableLocation,
});
