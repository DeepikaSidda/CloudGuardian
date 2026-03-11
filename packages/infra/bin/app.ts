#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { GovernanceStack } from "../src/governance-stack";

const app = new cdk.App();

new GovernanceStack(app, "GovernanceEngineStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
  scanSchedule: process.env.SCAN_SCHEDULE,
  reportSchedule: process.env.REPORT_SCHEDULE,
  sesEmailIdentity: process.env.SES_EMAIL_IDENTITY,
});
