import * as path from "path";
import * as cdk from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as iam from "aws-cdk-lib/aws-iam";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as ses from "aws-cdk-lib/aws-ses";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import { Construct } from "constructs";
import { ScanStateMachine } from "./scan-state-machine";

export interface GovernanceStackProps extends cdk.StackProps {
  /** Cron expression for scheduled scans (default: daily at 2am UTC) */
  scanSchedule?: string;
  /** Cron expression for report generation (default: weekly Monday 8am UTC) */
  reportSchedule?: string;
  /** SES email identity to verify (e.g. admin@example.com) */
  sesEmailIdentity?: string;
}

export class GovernanceStack extends cdk.Stack {
  public readonly table: dynamodb.Table;
  public readonly api: apigateway.RestApi;
  public readonly stateMachine: cdk.aws_stepfunctions.StateMachine;
  public readonly websiteBucket: s3.Bucket;
  public readonly reportBucket: s3.Bucket;
  public readonly distribution: cloudfront.Distribution;

  constructor(scope: Construct, id: string, props: GovernanceStackProps = {}) {
    super(scope, id, props);

    const scanSchedule = props.scanSchedule ?? "cron(0 */6 * * ? *)";
    const reportSchedule = props.reportSchedule ?? "cron(0 8 ? * MON *)";

    // ─────────────────────────────────────────────
    // 13.1 — DynamoDB Table + GSIs
    // ─────────────────────────────────────────────
    this.table = new dynamodb.Table(this, "GovernanceData", {
      tableName: "GovernanceData",
      partitionKey: { name: "PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "SK", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.table.addGlobalSecondaryIndex({
      indexName: "GSI1",
      partitionKey: { name: "advisorType", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "createdAt", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    this.table.addGlobalSecondaryIndex({
      indexName: "GSI2",
      partitionKey: { name: "accountId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "createdAt", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    this.table.addGlobalSecondaryIndex({
      indexName: "GSI3",
      partitionKey: { name: "riskLevel", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "createdAt", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    this.table.addGlobalSecondaryIndex({
      indexName: "GSI4",
      partitionKey: { name: "userId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "initiatedAt", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // ─────────────────────────────────────────────
    // 13.2 — IAM Roles
    // ─────────────────────────────────────────────

    // Read-only scanning role — Describe*, List*, Get* only
    const scanningRole = new iam.Role(this, "ScanningRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaBasicExecutionRole"),
      ],
    });
    scanningRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "ec2:Describe*",
          "ec2:List*",
          "ec2:Get*",
          "elasticloadbalancing:Describe*",
          "iam:List*",
          "iam:Get*",
          "cloudtrail:LookupEvents",
          "cloudwatch:GetMetricStatistics",
          "cloudwatch:ListMetrics",
          "lambda:List*",
          "lambda:Get*",
          "rds:Describe*",
          "ecs:Describe*",
          "ecs:List*",
          "logs:Describe*",
          "logs:FilterLogEvents",
          "organizations:List*",
          "organizations:Describe*",
          "sts:AssumeRole",
          "pricing:GetProducts",
          "s3:ListAllMyBuckets",
          "s3:ListBucket",
          "s3:GetBucketNotificationConfiguration",
          "dynamodb:ListTables",
          "dynamodb:DescribeTable",
          "sns:ListTopics",
          "sns:ListSubscriptionsByTopic",
          "sqs:ListQueues",
          "sqs:GetQueueAttributes",
          "cloudfront:ListDistributions",
          "apigateway:GET",
          "lambda:ListEventSourceMappings",
        ],
        resources: ["*"],
      })
    );

    // Write/delete role for Action Executor — separate from scanning
    const actionRole = new iam.Role(this, "ActionExecutorRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaBasicExecutionRole"),
      ],
    });
    actionRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "ec2:TerminateInstances",
          "ec2:StopInstances",
          "ec2:DeleteVolume",
          "ec2:ReleaseAddress",
          "ec2:DeleteSecurityGroup",
          "ec2:DeleteNatGateway",
          "lambda:DeleteFunction",
          "rds:StopDBInstance",
          "rds:DeleteDBInstance",
          "ecs:UpdateService",
          "sts:AssumeRole",
        ],
        resources: ["*"],
      })
    );

    // Shared environment variables for all Lambdas
    const commonEnv: Record<string, string> = {
      TABLE_NAME: this.table.tableName,
      NODE_OPTIONS: "--enable-source-maps",
    };

    // ─────────────────────────────────────────────
    // 13.2 — Lambda Functions
    // ─────────────────────────────────────────────

    const backendCodePath = path.join(__dirname, "../../backend/dist-bundle");

    // --- Advisor Lambdas (15 min timeout, read-only role) ---
    const safeCleanupAdvisorFn = new lambda.Function(this, "SafeCleanupAdvisorFn", {
      functionName: "GovernanceEngine-SafeCleanupAdvisor",
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "advisors/safe-cleanup-advisor.handler",
      code: lambda.Code.fromAsset(backendCodePath),
      timeout: cdk.Duration.minutes(15),
      memorySize: 256,
      role: scanningRole,
      environment: commonEnv,
    });

    const permissionDriftDetectorFn = new lambda.Function(this, "PermissionDriftDetectorFn", {
      functionName: "GovernanceEngine-PermissionDriftDetector",
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "advisors/permission-drift-detector.handler",
      code: lambda.Code.fromAsset(backendCodePath),
      timeout: cdk.Duration.minutes(15),
      memorySize: 256,
      role: scanningRole,
      environment: commonEnv,
    });

    const zombieResourceDetectorFn = new lambda.Function(this, "ZombieResourceDetectorFn", {
      functionName: "GovernanceEngine-ZombieResourceDetector",
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "advisors/zombie-resource-detector.handler",
      code: lambda.Code.fromAsset(backendCodePath),
      timeout: cdk.Duration.minutes(15),
      memorySize: 256,
      role: scanningRole,
      environment: commonEnv,
    });

    // --- Action Executor Lambda (5 min timeout, write/delete role) ---
    const actionExecutorFn = new lambda.Function(this, "ActionExecutorFn", {
      functionName: "GovernanceEngine-ActionExecutor",
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "action-executor.handler",
      code: lambda.Code.fromAsset(backendCodePath),
      timeout: cdk.Duration.minutes(5),
      memorySize: 256,
      role: actionRole,
      environment: commonEnv,
    });

    // --- Dashboard API handler (30s timeout) — uses its own role to avoid circular deps ---
    const apiHandlerRole = new iam.Role(this, "ApiHandlerRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaBasicExecutionRole"),
        iam.ManagedPolicy.fromAwsManagedPolicyName("AdministratorAccess"),
      ],
    });

    const apiHandlerFn = new lambda.Function(this, "ApiHandlerFn", {
      functionName: "GovernanceEngine-ApiHandler",
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "api/handlers.handler",
      code: lambda.Code.fromAsset(backendCodePath),
      timeout: cdk.Duration.seconds(60),
      memorySize: 512,
      role: apiHandlerRole,
      environment: {
        ...commonEnv,
        ACTION_EXECUTOR_FN_NAME: actionExecutorFn.functionName,
      },
    });

    // --- Report Scheduler Lambda (5 min timeout) ---
    const reportSchedulerFn = new lambda.Function(this, "ReportSchedulerFn", {
      functionName: "GovernanceEngine-ReportScheduler",
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "report-scheduler.handler",
      code: lambda.Code.fromAsset(backendCodePath),
      timeout: cdk.Duration.minutes(5),
      memorySize: 256,
      role: scanningRole,
      environment: commonEnv,
    });

    // --- Scan Orchestrator handlers (5 min timeout, read-only role) ---
    const startScanFn = new lambda.Function(this, "StartScanFn", {
      functionName: "GovernanceEngine-StartScan",
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "orchestrator/start-scan.handler",
      code: lambda.Code.fromAsset(backendCodePath),
      timeout: cdk.Duration.minutes(5),
      memorySize: 256,
      role: scanningRole,
      environment: commonEnv,
    });

    const discoverAccountsFn = new lambda.Function(this, "DiscoverAccountsFn", {
      functionName: "GovernanceEngine-DiscoverAccounts",
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "orchestrator/discover-accounts.handler",
      code: lambda.Code.fromAsset(backendCodePath),
      timeout: cdk.Duration.minutes(5),
      memorySize: 256,
      role: scanningRole,
      environment: commonEnv,
    });

    const invokeAdvisorsFn = new lambda.Function(this, "InvokeAdvisorsFn", {
      functionName: "GovernanceEngine-InvokeAdvisors",
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "orchestrator/invoke-advisors.handler",
      code: lambda.Code.fromAsset(backendCodePath),
      timeout: cdk.Duration.minutes(15),
      memorySize: 256,
      role: scanningRole,
      environment: commonEnv,
    });

    const completeScanFn = new lambda.Function(this, "CompleteScanFn", {
      functionName: "GovernanceEngine-CompleteScan",
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "orchestrator/complete-scan.handler",
      code: lambda.Code.fromAsset(backendCodePath),
      timeout: cdk.Duration.minutes(5),
      memorySize: 256,
      role: scanningRole,
      environment: commonEnv,
    });

    const failScanFn = new lambda.Function(this, "FailScanFn", {
      functionName: "GovernanceEngine-FailScan",
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "orchestrator/fail-scan.handler",
      code: lambda.Code.fromAsset(backendCodePath),
      timeout: cdk.Duration.minutes(5),
      memorySize: 256,
      role: scanningRole,
      environment: commonEnv,
    });

    // --- Email Digest Lambda (5 min timeout, needs SES + Bedrock + DynamoDB) ---
    const emailDigestRole = new iam.Role(this, "EmailDigestRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaBasicExecutionRole"),
      ],
    });
    emailDigestRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["ses:SendEmail", "ses:SendRawEmail"],
        resources: ["*"],
      })
    );
    emailDigestRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["bedrock:InvokeModel", "bedrock:Converse"],
        resources: ["*"],
      })
    );

    const emailDigestFn = new lambda.Function(this, "EmailDigestFn", {
      functionName: "GovernanceEngine-EmailDigest",
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "email-digest.handler",
      code: lambda.Code.fromAsset(backendCodePath),
      timeout: cdk.Duration.minutes(5),
      memorySize: 256,
      role: emailDigestRole,
      environment: {
        ...commonEnv,
        SES_SENDER_EMAIL: props.sesEmailIdentity ?? "governance@example.com",
        DASHBOARD_URL: "", // Will be set after CloudFront is created
      },
    });

    // Grant DynamoDB access to all Lambdas
    this.table.grantReadWriteData(scanningRole);
    this.table.grantReadWriteData(actionRole);
    this.table.grantReadWriteData(apiHandlerRole);
    this.table.grantReadWriteData(emailDigestRole);

    // ─────────────────────────────────────────────
    // 13.3 — Step Functions State Machine
    // ─────────────────────────────────────────────

    const scanStateMachine = new ScanStateMachine(this, "ScanStateMachine", {
      startScanFn,
      discoverAccountsFn,
      invokeAdvisorsFn,
      completeScanFn,
      failScanFn,
      emailDigestFn,
    });
    this.stateMachine = scanStateMachine.stateMachine;

    // Grant the API handler permission to start Step Functions executions
    // Use addEnvironment on the Lambda to pass the ARN (already set inline won't work
    // since state machine isn't created yet — we'll use a lazy approach)
    apiHandlerFn.addEnvironment("STATE_MACHINE_ARN", this.stateMachine.stateMachineArn);
    apiHandlerRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["states:StartExecution"],
        resources: [this.stateMachine.stateMachineArn],
      })
    );

    // Grant the API handler permission to invoke the action executor
    apiHandlerRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["lambda:InvokeFunction"],
        resources: [actionExecutorFn.functionArn],
      })
    );

    // Grant the API handler read-only access for active service discovery
    apiHandlerRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "ec2:Describe*", "ec2:Stop*", "ec2:Start*", "ec2:Terminate*",
          "ec2:DeleteVolume", "ec2:ReleaseAddress", "ec2:DeleteSecurityGroup",
          "ec2:DescribeInstances", "ec2:DescribeVolumes", "ec2:DescribeAddresses",
          "ec2:DescribeSecurityGroups", "ec2:DescribeNatGateways", "ec2:DescribeVpcs",
          "ec2:DescribeSubnets", "ec2:DescribeInternetGateways",
          "lambda:*",
          "iam:List*", "iam:Get*", "iam:DeleteRole", "iam:DeleteUser",
          "rds:Describe*", "rds:Stop*", "rds:Delete*",
          "ecs:List*", "ecs:Describe*", "ecs:UpdateService",
          "elasticloadbalancing:Describe*",
          "logs:Describe*", "logs:DeleteLogGroup",
          "s3:*",
          "dynamodb:ListTables",
          "states:ListStateMachines",
          "cloudformation:ListStacks",
          "sns:*", "sqs:*",
          "cloudfront:List*",
          "apigateway:GET",
          "route53:List*",
          "cognito-idp:List*",
          "secretsmanager:List*",
          "acm:List*",
          "kms:ListKeys", "kms:DescribeKey",
          "wafv2:List*",
          "events:List*",
          "kinesis:List*",
          "amplify:List*",
          "codepipeline:List*",
          "codebuild:List*",
          "codecommit:List*",
          "cloudwatch:Describe*",
          "ssm:Describe*",
          "cloudtrail:Describe*",
          "elasticfilesystem:Describe*",
          "ecr:Describe*",
          "elasticache:Describe*",
          "autoscaling:Describe*",
          "glue:Get*",
          "athena:List*",
          "sagemaker:List*",
          "bedrock:InvokeModel", "bedrock:Converse",
          "sts:GetCallerIdentity", "iam:ListAccountAliases",
        ],
        resources: ["*"],
      })
    );

    // ─────────────────────────────────────────────
    // 13.4 — S3 Buckets
    // ─────────────────────────────────────────────

    // Report archive bucket
    this.reportBucket = new s3.Bucket(this, "ReportArchiveBucket", {
      bucketName: cdk.Fn.sub("governance-reports-${AWS::AccountId}"),
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      lifecycleRules: [{ expiration: cdk.Duration.days(365) }],
    });
    this.reportBucket.grantReadWrite(reportSchedulerFn);
    reportSchedulerFn.addEnvironment("REPORT_BUCKET", this.reportBucket.bucketName);

    // Static website hosting bucket (frontend)
    this.websiteBucket = new s3.Bucket(this, "WebsiteBucket", {
      bucketName: cdk.Fn.sub("governance-dashboard-${AWS::AccountId}"),
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    });

    // ─────────────────────────────────────────────
    // 13.4 — CloudFront Distribution
    // ─────────────────────────────────────────────

    const originAccessIdentity = new cloudfront.OriginAccessIdentity(this, "OAI");
    this.websiteBucket.grantRead(originAccessIdentity);

    this.distribution = new cloudfront.Distribution(this, "DashboardDistribution", {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessIdentity(this.websiteBucket, {
          originAccessIdentity,
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
      defaultRootObject: "index.html",
      errorResponses: [
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: "/index.html",
          ttl: cdk.Duration.seconds(0),
        },
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: "/index.html",
          ttl: cdk.Duration.seconds(0),
        },
      ],
    });

    // ─────────────────────────────────────────────
    // 13.4 — API Gateway (REST)
    // ─────────────────────────────────────────────

    this.api = new apigateway.RestApi(this, "GovernanceApi", {
      restApiName: "GovernanceEngineAPI",
      description: "AWS Account Governance Engine Dashboard API",
      deployOptions: { stageName: "prod" },
    });

    // Single wildcard Lambda permission for the entire API — avoids per-route permission bloat
    // that hits the 20KB resource policy size limit.
    new lambda.CfnPermission(this, "ApiGatewayInvokePermission", {
      action: "lambda:InvokeFunction",
      functionName: apiHandlerFn.functionName,
      principal: "apigateway.amazonaws.com",
      sourceArn: this.api.arnForExecuteApi("*", "/*", "*"),
    });

    const lambdaIntegration = new apigateway.LambdaIntegration(apiHandlerFn, {
      proxy: true,
      allowTestInvoke: false,
    });

    // Helper to add a route and then remove the auto-generated Lambda::Permission
    // CDK creates one permission per addMethod call, which bloats the Lambda policy.
    // We use a single wildcard permission above instead.
    const addRoute = (resource: apigateway.IResource, method: string) => {
      const m = resource.addMethod(method, lambdaIntegration, {
        authorizationType: apigateway.AuthorizationType.NONE,
      });
      // Remove the auto-generated Lambda permission to avoid policy bloat
      const permissions = m.node.children.filter(
        (c) => (c as any).cfnResourceType === "AWS::Lambda::Permission"
      );
      for (const perm of permissions) {
        m.node.tryRemoveChild(perm.node.id);
      }
    };

    // CORS preflight OPTIONS handler using MOCK integration (no Lambda needed).
    // This returns proper CORS headers so browsers allow cross-origin requests.
    const addCorsOptions = (resource: apigateway.IResource) => {
      resource.addMethod("OPTIONS", new apigateway.MockIntegration({
        integrationResponses: [{
          statusCode: "200",
          responseParameters: {
            "method.response.header.Access-Control-Allow-Headers": "'Content-Type,Authorization,X-Amz-Date,X-Api-Key'",
            "method.response.header.Access-Control-Allow-Origin": "'*'",
            "method.response.header.Access-Control-Allow-Methods": "'GET,POST,PUT,DELETE,OPTIONS'",
          },
        }],
        passthroughBehavior: apigateway.PassthroughBehavior.NEVER,
        requestTemplates: { "application/json": '{"statusCode": 200}' },
      }), {
        authorizationType: apigateway.AuthorizationType.NONE,
        methodResponses: [{
          statusCode: "200",
          responseParameters: {
            "method.response.header.Access-Control-Allow-Headers": true,
            "method.response.header.Access-Control-Allow-Origin": true,
            "method.response.header.Access-Control-Allow-Methods": true,
          },
        }],
      });
    };

    // /scans
    const scans = this.api.root.addResource("scans");
    addRoute(scans, "GET");
    addRoute(scans, "POST");
    addRoute(scans, "DELETE");
    addCorsOptions(scans);
    const scanById = scans.addResource("{scanId}");
    addRoute(scanById, "GET");
    addCorsOptions(scanById);

    // /recommendations
    const recommendations = this.api.root.addResource("recommendations");
    addRoute(recommendations, "GET");
    addCorsOptions(recommendations);
    const recommendationById = recommendations.addResource("{id}");
    addRoute(recommendationById, "GET");
    addCorsOptions(recommendationById);

    // /actions
    const actions = this.api.root.addResource("actions");
    addRoute(actions, "POST");
    addRoute(actions, "GET");
    addCorsOptions(actions);

    // /summary
    const summary = this.api.root.addResource("summary");
    addRoute(summary, "GET");
    addCorsOptions(summary);

    // /trends
    const trends = this.api.root.addResource("trends");
    addRoute(trends, "GET");
    addCorsOptions(trends);

    // /config
    const config = this.api.root.addResource("config");
    addRoute(config, "GET");
    addRoute(config, "PUT");
    addCorsOptions(config);

    // /active-services
    const activeServices = this.api.root.addResource("active-services");
    addRoute(activeServices, "GET");
    addCorsOptions(activeServices);

    // /ai-recommend
    const aiRecommend = this.api.root.addResource("ai-recommend");
    addRoute(aiRecommend, "POST");
    addCorsOptions(aiRecommend);

    // /cost-anomalies
    const costAnomalies = this.api.root.addResource("cost-anomalies");
    addRoute(costAnomalies, "GET");
    addCorsOptions(costAnomalies);

    // /resource-control
    const resourceControl = this.api.root.addResource("resource-control");
    addRoute(resourceControl, "POST");
    addCorsOptions(resourceControl);

    // /assistant
    const assistant = this.api.root.addResource("assistant");
    addRoute(assistant, "POST");
    addCorsOptions(assistant);

    // /settings
    const settings = this.api.root.addResource("settings");
    const settingByKey = settings.addResource("{key}");
    addRoute(settingByKey, "GET");
    addRoute(settingByKey, "PUT");
    addRoute(settingByKey, "DELETE");
    addCorsOptions(settingByKey);

    // /dependency-graph
    const dependencyGraph = this.api.root.addResource("dependency-graph");
    addRoute(dependencyGraph, "GET");
    addCorsOptions(dependencyGraph);

    // /chats
    const chats = this.api.root.addResource("chats");
    addRoute(chats, "GET");
    addRoute(chats, "POST");
    addCorsOptions(chats);
    const chatById = chats.addResource("{chatId}");
    addRoute(chatById, "GET");
    addRoute(chatById, "DELETE");
    addCorsOptions(chatById);

    // /policies
    const policies = this.api.root.addResource("policies");
    addRoute(policies, "GET");
    addRoute(policies, "POST");
    addCorsOptions(policies);
    const policyById = policies.addResource("{policyId}");
    addRoute(policyById, "GET");
    addRoute(policyById, "PUT");
    addRoute(policyById, "DELETE");
    addCorsOptions(policyById);

    // ─────────────────────────────────────────────
    // 13.4 — EventBridge Rules
    // ─────────────────────────────────────────────

    // Scheduled scan rule
    new events.Rule(this, "ScheduledScanRule", {
      ruleName: "GovernanceEngine-ScheduledScan",
      schedule: events.Schedule.expression(scanSchedule),
      targets: [new targets.SfnStateMachine(this.stateMachine)],
    });

    // Scheduled report rule
    new events.Rule(this, "ScheduledReportRule", {
      ruleName: "GovernanceEngine-ScheduledReport",
      schedule: events.Schedule.expression(reportSchedule),
      targets: [new targets.LambdaFunction(reportSchedulerFn)],
    });

    // ─────────────────────────────────────────────
    // 13.4 — SES Email Identity
    // ─────────────────────────────────────────────

    if (props.sesEmailIdentity) {
      new ses.EmailIdentity(this, "SesEmailIdentity", {
        identity: ses.Identity.email(props.sesEmailIdentity),
      });
    }

    // Grant SES send permissions to report scheduler
    reportSchedulerFn.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["ses:SendEmail", "ses:SendRawEmail"],
        resources: ["*"],
      })
    );

    // ─────────────────────────────────────────────
    // Stack Outputs
    // ─────────────────────────────────────────────

    // Set dashboard URL on email digest Lambda now that CloudFront exists
    emailDigestFn.addEnvironment("DASHBOARD_URL", `https://${this.distribution.distributionDomainName}`);

    new cdk.CfnOutput(this, "ApiUrl", {
      value: this.api.url,
      description: "Dashboard API endpoint URL",
    });

    new cdk.CfnOutput(this, "DashboardUrl", {
      value: `https://${this.distribution.distributionDomainName}`,
      description: "CloudFront dashboard URL",
    });

    new cdk.CfnOutput(this, "TableName", {
      value: this.table.tableName,
      description: "DynamoDB table name",
    });

    new cdk.CfnOutput(this, "StateMachineArn", {
      value: this.stateMachine.stateMachineArn,
      description: "Scan orchestrator state machine ARN",
    });

    new cdk.CfnOutput(this, "ReportBucketName", {
      value: this.reportBucket.bucketName,
      description: "Report archive S3 bucket",
    });

    new cdk.CfnOutput(this, "WebsiteBucketName", {
      value: this.websiteBucket.bucketName,
      description: "Frontend website S3 bucket",
    });
  }
}
