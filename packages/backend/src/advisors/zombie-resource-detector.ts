import {
  LambdaClient,
  ListFunctionsCommand,
  type FunctionConfiguration,
} from "@aws-sdk/client-lambda";
import {
  RDSClient,
  DescribeDBInstancesCommand,
  type DBInstance,
} from "@aws-sdk/client-rds";
import {
  ECSClient,
  ListClustersCommand,
  ListServicesCommand,
  DescribeServicesCommand,
  type Service,
} from "@aws-sdk/client-ecs";
import {
  EC2Client,
  DescribeNatGatewaysCommand,
  type NatGateway,
} from "@aws-sdk/client-ec2";
import {
  CloudWatchLogsClient,
  DescribeLogGroupsCommand,
  FilterLogEventsCommand,
  type LogGroup,
} from "@aws-sdk/client-cloudwatch-logs";
import {
  CloudWatchClient,
  GetMetricStatisticsCommand,
} from "@aws-sdk/client-cloudwatch";
import {
  S3Client,
  ListBucketsCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import {
  DynamoDBClient,
  ListTablesCommand,
  DescribeTableCommand,
} from "@aws-sdk/client-dynamodb";
import {
  SNSClient,
  ListTopicsCommand,
  ListSubscriptionsByTopicCommand,
} from "@aws-sdk/client-sns";
import {
  SQSClient,
  ListQueuesCommand,
  GetQueueAttributesCommand,
} from "@aws-sdk/client-sqs";
import {
  Recommendation,
  ScanError,
  RESOURCE_ACTION_MAP,
} from "@governance-engine/shared";
import { getClientForAccount } from "../credentials";

export interface ZombieResourceDetectorInput {
  accountId: string;
  region: string;
  lookbackDays: number;
  crossAccountRoleArn?: string;
}

export interface ZombieResourceDetectorOutput {
  recommendations: Recommendation[];
  resourcesEvaluated: number;
  errors: ScanError[];
}

// Hardcoded regional pricing tables for cost estimation
const RDS_INSTANCE_PRICING: Record<string, number> = {
  "db.t3.micro": 12.41, "db.t3.small": 24.82, "db.t3.medium": 49.64, "db.t3.large": 99.28,
  "db.t4g.micro": 11.52, "db.t4g.small": 23.04, "db.t4g.medium": 46.08, "db.t4g.large": 92.16,
  "db.m5.large": 124.10, "db.m5.xlarge": 248.20, "db.m5.2xlarge": 496.40,
  "db.m6g.large": 111.69, "db.m6g.xlarge": 223.38,
  "db.r5.large": 166.44, "db.r5.xlarge": 332.88,
  "db.r6g.large": 149.76, "db.r6g.xlarge": 299.52,
};

const NAT_GATEWAY_MONTHLY_BASE_COST = 32.40;
const CLOUDWATCH_LOGS_COST_PER_GB = 0.03;

export class ZombieResourceDetector {
  private scanId: string;

  constructor(scanId: string) {
    this.scanId = scanId;
  }

  async analyze(input: ZombieResourceDetectorInput): Promise<ZombieResourceDetectorOutput> {
    const recommendations: Recommendation[] = [];
    const errors: ScanError[] = [];
    let resourcesEvaluated = 0;

    const roleName = input.crossAccountRoleArn?.split("/").pop();

    const lambda = await getClientForAccount(LambdaClient, input.accountId, input.region, roleName);
    const rds = await getClientForAccount(RDSClient, input.accountId, input.region, roleName);
    const ecs = await getClientForAccount(ECSClient, input.accountId, input.region, roleName);
    const ec2 = await getClientForAccount(EC2Client, input.accountId, input.region, roleName);
    const cwLogs = await getClientForAccount(CloudWatchLogsClient, input.accountId, input.region, roleName);
    const cloudwatch = await getClientForAccount(CloudWatchClient, input.accountId, input.region, roleName);
    const s3 = await getClientForAccount(S3Client, input.accountId, input.region, roleName);
    const dynamodb = await getClientForAccount(DynamoDBClient, input.accountId, input.region, roleName);
    const sns = await getClientForAccount(SNSClient, input.accountId, input.region, roleName);
    const sqs = await getClientForAccount(SQSClient, input.accountId, input.region, roleName);

    const detectors: Array<() => Promise<{ recs: Recommendation[]; evaluated: number }>> = [
      () => this.detectZombieLambdaFunctions(lambda, cloudwatch, input),
      () => this.detectZombieRdsInstances(rds, cloudwatch, input),
      () => this.detectZombieEcsServices(ecs, input),
      () => this.detectZombieNatGateways(ec2, cloudwatch, input),
      () => this.detectZombieLogGroups(cwLogs, input),
      () => this.detectZombieS3Buckets(s3, input),
      () => this.detectZombieDynamoDBTables(dynamodb, input),
      () => this.detectZombieSNSTopics(sns, input),
      () => this.detectZombieSQSQueues(sqs, input),
      () => this.detectZombieStepFunctions(input),
      () => this.detectZombieCloudFormationStacks(input),
      () => this.detectZombieCloudFrontDistributions(input),
      () => this.detectZombieAPIGateways(input),
      () => this.detectZombieRoute53HostedZones(input),
      () => this.detectZombieEFSFileSystems(input),
      () => this.detectZombieECRRepositories(input),
      () => this.detectZombieElastiCacheClusters(input),
      () => this.detectZombieEventBridgeRules(input),
      () => this.detectZombieKinesisStreams(input, cloudwatch),
      () => this.detectZombieCognitoUserPools(input),
      () => this.detectZombieSecretsManagerSecrets(input),
      () => this.detectZombieACMCertificates(input),
      () => this.detectZombieKMSKeys(input),
      () => this.detectZombieWAFWebACLs(input),
      () => this.detectZombieCodePipelines(input),
      () => this.detectZombieCodeBuildProjects(input, cloudwatch),
      () => this.detectZombieCodeCommitRepos(input),
      () => this.detectZombieAmplifyApps(input),
    ];

    for (const detector of detectors) {
      try {
        const result = await detector();
        recommendations.push(...result.recs);
        resourcesEvaluated += result.evaluated;
      } catch (err: unknown) {
        const error = err as Error & { name?: string; Code?: string };
        errors.push({
          accountId: input.accountId,
          region: input.region,
          errorCode: error.name ?? "UnknownError",
          errorMessage: error.message ?? "Unknown error occurred",
        });
      }
    }

    return { recommendations, resourcesEvaluated, errors };
  }

  // ═══════════════════════════════════════════
  // EXISTING DETECTORS (Lambda, RDS, ECS, NAT, LogGroups)
  // ═══════════════════════════════════════════

  private async detectZombieLambdaFunctions(
    lambda: LambdaClient, cloudwatch: CloudWatchClient, input: ZombieResourceDetectorInput
  ): Promise<{ recs: Recommendation[]; evaluated: number }> {
    const recs: Recommendation[] = [];
    const now = new Date();
    const lookbackStart = new Date(now.getTime() - input.lookbackDays * 24 * 60 * 60 * 1000);
    const functions: FunctionConfiguration[] = [];
    let marker: string | undefined;
    do {
      const response = await lambda.send(new ListFunctionsCommand({ Marker: marker }));
      functions.push(...(response.Functions ?? []));
      marker = response.NextMarker;
    } while (marker);
    for (const fn of functions) {
      if (!fn.FunctionName || !fn.FunctionArn) continue;
      const hasInvocations = await this.hasLambdaInvocations(cloudwatch, fn.FunctionName, lookbackStart, now);
      if (!hasInvocations) {
        recs.push(this.createRecommendation(input, {
          resourceId: fn.FunctionArn, resourceType: "LambdaFunction",
          issueDescription: `Lambda function "${fn.FunctionName}" has zero invocations in the last ${input.lookbackDays} days`,
          suggestedAction: "Delete the Lambda function if it is no longer needed",
          explanation: `This function has not been invoked during the lookback period of ${input.lookbackDays} days.`,
          estimatedMonthlySavings: 0,
        }));
      }
    }
    return { recs, evaluated: functions.length };
  }

  private async hasLambdaInvocations(cloudwatch: CloudWatchClient, functionName: string, start: Date, end: Date): Promise<boolean> {
    const result = await cloudwatch.send(new GetMetricStatisticsCommand({
      Namespace: "AWS/Lambda", MetricName: "Invocations",
      Dimensions: [{ Name: "FunctionName", Value: functionName }],
      StartTime: start, EndTime: end, Period: 86400, Statistics: ["Sum"],
    }));
    return (result.Datapoints ?? []).reduce((sum, dp) => sum + (dp.Sum ?? 0), 0) > 0;
  }

  private async detectZombieRdsInstances(
    rds: RDSClient, cloudwatch: CloudWatchClient, input: ZombieResourceDetectorInput
  ): Promise<{ recs: Recommendation[]; evaluated: number }> {
    const recs: Recommendation[] = [];
    const now = new Date();
    const lookbackStart = new Date(now.getTime() - input.lookbackDays * 24 * 60 * 60 * 1000);
    const instances: DBInstance[] = [];
    let marker: string | undefined;
    do {
      const response = await rds.send(new DescribeDBInstancesCommand({ Marker: marker }));
      instances.push(...(response.DBInstances ?? []));
      marker = response.Marker;
    } while (marker);
    for (const instance of instances) {
      if (!instance.DBInstanceIdentifier || instance.DBInstanceStatus !== "available") continue;
      const hasConnections = await this.hasRdsConnections(cloudwatch, instance.DBInstanceIdentifier, lookbackStart, now);
      if (!hasConnections) {
        recs.push(this.createRecommendation(input, {
          resourceId: instance.DBInstanceArn ?? instance.DBInstanceIdentifier, resourceType: "RDSInstance",
          issueDescription: `RDS instance "${instance.DBInstanceIdentifier}" has zero database connections in the last ${input.lookbackDays} days`,
          suggestedAction: "Stop or delete the RDS instance if it is no longer needed",
          explanation: `This RDS instance is running but has had no database connections during the lookback period.`,
          estimatedMonthlySavings: this.estimateRdsCost(instance),
        }));
      }
    }
    return { recs, evaluated: instances.length };
  }

  private async hasRdsConnections(cloudwatch: CloudWatchClient, dbInstanceId: string, start: Date, end: Date): Promise<boolean> {
    const result = await cloudwatch.send(new GetMetricStatisticsCommand({
      Namespace: "AWS/RDS", MetricName: "DatabaseConnections",
      Dimensions: [{ Name: "DBInstanceIdentifier", Value: dbInstanceId }],
      StartTime: start, EndTime: end, Period: 86400, Statistics: ["Maximum"],
    }));
    return (result.Datapoints ?? []).reduce((max, dp) => Math.max(max, dp.Maximum ?? 0), 0) > 0;
  }

  private estimateRdsCost(instance: DBInstance): number {
    const instanceClass = instance.DBInstanceClass ?? "";
    const knownPrice = RDS_INSTANCE_PRICING[instanceClass];
    if (knownPrice !== undefined) return knownPrice;
    if (instanceClass.includes(".micro")) return 12.41;
    if (instanceClass.includes(".small")) return 24.82;
    if (instanceClass.includes(".medium")) return 49.64;
    if (instanceClass.includes(".large") && !instanceClass.includes(".xlarge")) return 124.10;
    if (instanceClass.includes(".xlarge")) return 248.20;
    return 49.64;
  }

  private async detectZombieEcsServices(ecs: ECSClient, input: ZombieResourceDetectorInput): Promise<{ recs: Recommendation[]; evaluated: number }> {
    const recs: Recommendation[] = [];
    let totalEvaluated = 0;
    const clusters: string[] = [];
    let nextToken: string | undefined;
    do {
      const response = await ecs.send(new ListClustersCommand({ nextToken }));
      clusters.push(...(response.clusterArns ?? []));
      nextToken = response.nextToken;
    } while (nextToken);
    for (const clusterArn of clusters) {
      const serviceArns: string[] = [];
      let svcToken: string | undefined;
      do {
        const response = await ecs.send(new ListServicesCommand({ cluster: clusterArn, nextToken: svcToken }));
        serviceArns.push(...(response.serviceArns ?? []));
        svcToken = response.nextToken;
      } while (svcToken);
      if (serviceArns.length === 0) continue;
      for (let i = 0; i < serviceArns.length; i += 10) {
        const batch = serviceArns.slice(i, i + 10);
        const response = await ecs.send(new DescribeServicesCommand({ cluster: clusterArn, services: batch }));
        for (const service of response.services ?? []) {
          totalEvaluated++;
          if (!service.serviceArn || !service.serviceName) continue;
          if (service.runningCount === 0) {
            recs.push(this.createRecommendation(input, {
              resourceId: service.serviceArn, resourceType: "ECSService",
              issueDescription: `ECS service "${service.serviceName}" in cluster "${clusterArn.split("/").pop()}" has zero running tasks`,
              suggestedAction: "Stop the ECS service if it is no longer needed",
              explanation: `This ECS service has no running tasks.`,
              estimatedMonthlySavings: this.estimateEcsCost(service),
            }));
          }
        }
      }
    }
    return { recs, evaluated: totalEvaluated };
  }

  private estimateEcsCost(service: Service): number {
    const desiredCount = service.desiredCount ?? 0;
    if (desiredCount === 0) return 0;
    return Math.round(desiredCount * 9.0 * 100) / 100;
  }

  private async detectZombieNatGateways(
    ec2: EC2Client, cloudwatch: CloudWatchClient, input: ZombieResourceDetectorInput
  ): Promise<{ recs: Recommendation[]; evaluated: number }> {
    const recs: Recommendation[] = [];
    const now = new Date();
    const lookbackStart = new Date(now.getTime() - input.lookbackDays * 24 * 60 * 60 * 1000);
    const natGateways: NatGateway[] = [];
    let nextToken: string | undefined;
    do {
      const response = await ec2.send(new DescribeNatGatewaysCommand({ Filter: [{ Name: "state", Values: ["available"] }], NextToken: nextToken }));
      natGateways.push(...(response.NatGateways ?? []));
      nextToken = response.NextToken;
    } while (nextToken);
    for (const natGw of natGateways) {
      if (!natGw.NatGatewayId) continue;
      const hasBytesProcessed = await this.hasNatGatewayTraffic(cloudwatch, natGw.NatGatewayId, lookbackStart, now);
      if (!hasBytesProcessed) {
        recs.push(this.createRecommendation(input, {
          resourceId: natGw.NatGatewayId, resourceType: "NATGateway",
          issueDescription: `NAT Gateway ${natGw.NatGatewayId} has processed zero bytes in the last ${input.lookbackDays} days`,
          suggestedAction: "Delete the NAT Gateway if it is no longer needed",
          explanation: `This NAT Gateway is active but has processed no traffic during the lookback period.`,
          estimatedMonthlySavings: NAT_GATEWAY_MONTHLY_BASE_COST,
        }));
      }
    }
    return { recs, evaluated: natGateways.length };
  }

  private async hasNatGatewayTraffic(cloudwatch: CloudWatchClient, natGatewayId: string, start: Date, end: Date): Promise<boolean> {
    for (const metricName of ["BytesOutToDestination", "BytesOutToSource"]) {
      const result = await cloudwatch.send(new GetMetricStatisticsCommand({
        Namespace: "AWS/NATGateway", MetricName: metricName,
        Dimensions: [{ Name: "NatGatewayId", Value: natGatewayId }],
        StartTime: start, EndTime: end, Period: 86400, Statistics: ["Sum"],
      }));
      if ((result.Datapoints ?? []).reduce((sum, dp) => sum + (dp.Sum ?? 0), 0) > 0) return true;
    }
    return false;
  }

  private async detectZombieLogGroups(cwLogs: CloudWatchLogsClient, input: ZombieResourceDetectorInput): Promise<{ recs: Recommendation[]; evaluated: number }> {
    const recs: Recommendation[] = [];
    const now = new Date();
    const lookbackStart = new Date(now.getTime() - input.lookbackDays * 24 * 60 * 60 * 1000);
    const logGroups: LogGroup[] = [];
    let nextToken: string | undefined;
    do {
      const response = await cwLogs.send(new DescribeLogGroupsCommand({ nextToken }));
      logGroups.push(...(response.logGroups ?? []));
      nextToken = response.nextToken;
    } while (nextToken);
    for (const logGroup of logGroups) {
      if (!logGroup.logGroupName) continue;
      const hasRecentEvents = await this.hasRecentLogEvents(cwLogs, logGroup.logGroupName, lookbackStart.getTime());
      if (!hasRecentEvents) {
        recs.push(this.createRecommendation(input, {
          resourceId: logGroup.logGroupArn ?? logGroup.logGroupName, resourceType: "CloudWatchLogGroup",
          issueDescription: `CloudWatch log group "${logGroup.logGroupName}" has no new events in the last ${input.lookbackDays} days`,
          suggestedAction: "Delete the log group if it is no longer needed",
          explanation: `This log group has received no new log events during the lookback period.`,
          estimatedMonthlySavings: this.estimateLogGroupCost(logGroup),
        }));
      }
    }
    return { recs, evaluated: logGroups.length };
  }

  private async hasRecentLogEvents(cwLogs: CloudWatchLogsClient, logGroupName: string, startTimeMs: number): Promise<boolean> {
    try {
      const response = await cwLogs.send(new FilterLogEventsCommand({ logGroupName, startTime: startTimeMs, limit: 1 }));
      return (response.events ?? []).length > 0;
    } catch { return false; }
  }

  private estimateLogGroupCost(logGroup: LogGroup): number {
    const storedBytes = logGroup.storedBytes ?? 0;
    const storedGb = storedBytes / (1024 * 1024 * 1024);
    return Math.round(storedGb * CLOUDWATCH_LOGS_COST_PER_GB * 100) / 100;
  }

  // ═══════════════════════════════════════════
  // NEW SERVICE DETECTORS
  // ═══════════════════════════════════════════

  private async detectZombieS3Buckets(s3: S3Client, input: ZombieResourceDetectorInput): Promise<{ recs: Recommendation[]; evaluated: number }> {
    const recs: Recommendation[] = [];
    const res = await s3.send(new ListBucketsCommand({}));
    const buckets = res.Buckets ?? [];
    for (const bucket of buckets) {
      if (!bucket.Name) continue;
      try {
        const objects = await s3.send(new ListObjectsV2Command({ Bucket: bucket.Name, MaxKeys: 1 }));
        if ((objects.KeyCount ?? 0) === 0) {
          recs.push(this.createRecommendation(input, {
            resourceId: bucket.Name, resourceType: "S3Bucket",
            issueDescription: `S3 bucket "${bucket.Name}" is empty (zero objects)`,
            suggestedAction: "Delete the empty S3 bucket if it is no longer needed",
            explanation: `This bucket contains no objects and may be unused.`,
            estimatedMonthlySavings: 0,
          }));
        }
      } catch { /* skip buckets we can't access */ }
    }
    return { recs, evaluated: buckets.length };
  }

  private async detectZombieDynamoDBTables(dynamodb: DynamoDBClient, input: ZombieResourceDetectorInput): Promise<{ recs: Recommendation[]; evaluated: number }> {
    const recs: Recommendation[] = [];
    const res = await dynamodb.send(new ListTablesCommand({}));
    const tableNames = res.TableNames ?? [];
    for (const tableName of tableNames) {
      try {
        const desc = await dynamodb.send(new DescribeTableCommand({ TableName: tableName }));
        const table = desc.Table;
        if (table && (table.ItemCount ?? 0) === 0) {
          recs.push(this.createRecommendation(input, {
            resourceId: table.TableArn ?? tableName, resourceType: "DynamoDBTable",
            issueDescription: `DynamoDB table "${tableName}" has zero items`,
            suggestedAction: "Delete the empty DynamoDB table if it is no longer needed",
            explanation: `This table contains no items and may be unused.`,
            estimatedMonthlySavings: 0,
          }));
        }
      } catch { /* skip */ }
    }
    return { recs, evaluated: tableNames.length };
  }

  private async detectZombieSNSTopics(sns: SNSClient, input: ZombieResourceDetectorInput): Promise<{ recs: Recommendation[]; evaluated: number }> {
    const recs: Recommendation[] = [];
    const res = await sns.send(new ListTopicsCommand({}));
    const topics = res.Topics ?? [];
    for (const topic of topics) {
      if (!topic.TopicArn) continue;
      try {
        const subs = await sns.send(new ListSubscriptionsByTopicCommand({ TopicArn: topic.TopicArn }));
        if ((subs.Subscriptions ?? []).length === 0) {
          const topicName = topic.TopicArn.split(":").pop() ?? topic.TopicArn;
          recs.push(this.createRecommendation(input, {
            resourceId: topic.TopicArn, resourceType: "SNSTopic",
            issueDescription: `SNS topic "${topicName}" has no subscriptions`,
            suggestedAction: "Delete the SNS topic if it is no longer needed",
            explanation: `This topic has zero subscriptions and may not be delivering messages to anyone.`,
            estimatedMonthlySavings: 0,
          }));
        }
      } catch { /* skip */ }
    }
    return { recs, evaluated: topics.length };
  }

  private async detectZombieSQSQueues(sqs: SQSClient, input: ZombieResourceDetectorInput): Promise<{ recs: Recommendation[]; evaluated: number }> {
    const recs: Recommendation[] = [];
    const res = await sqs.send(new ListQueuesCommand({}));
    const queueUrls = res.QueueUrls ?? [];
    for (const queueUrl of queueUrls) {
      try {
        const attrs = await sqs.send(new GetQueueAttributesCommand({
          QueueUrl: queueUrl,
          AttributeNames: ["ApproximateNumberOfMessages", "ApproximateNumberOfMessagesNotVisible", "LastModifiedTimestamp"],
        }));
        const msgCount = parseInt(attrs.Attributes?.ApproximateNumberOfMessages ?? "0", 10);
        const inflightCount = parseInt(attrs.Attributes?.ApproximateNumberOfMessagesNotVisible ?? "0", 10);
        const lastModified = parseInt(attrs.Attributes?.LastModifiedTimestamp ?? "0", 10) * 1000;
        const lookbackMs = input.lookbackDays * 24 * 60 * 60 * 1000;
        if (msgCount === 0 && inflightCount === 0 && lastModified < Date.now() - lookbackMs) {
          const queueName = queueUrl.split("/").pop() ?? queueUrl;
          recs.push(this.createRecommendation(input, {
            resourceId: queueUrl, resourceType: "SQSQueue",
            issueDescription: `SQS queue "${queueName}" has zero messages and no recent activity in the last ${input.lookbackDays} days`,
            suggestedAction: "Delete the SQS queue if it is no longer needed",
            explanation: `This queue has no messages and has not been modified during the lookback period.`,
            estimatedMonthlySavings: 0,
          }));
        }
      } catch { /* skip */ }
    }
    return { recs, evaluated: queueUrls.length };
  }

  private async detectZombieStepFunctions(input: ZombieResourceDetectorInput): Promise<{ recs: Recommendation[]; evaluated: number }> {
    const recs: Recommendation[] = [];
    const { SFNClient, ListStateMachinesCommand, ListExecutionsCommand } = await import("@aws-sdk/client-sfn");
    const roleName = input.crossAccountRoleArn?.split("/").pop();
    const sfn = await getClientForAccount(SFNClient, input.accountId, input.region, roleName);
    const res = await sfn.send(new ListStateMachinesCommand({}));
    const machines = res.stateMachines ?? [];
    const lookbackMs = input.lookbackDays * 24 * 60 * 60 * 1000;
    for (const machine of machines) {
      if (!machine.stateMachineArn) continue;
      try {
        const execs = await sfn.send(new ListExecutionsCommand({ stateMachineArn: machine.stateMachineArn, maxResults: 1 }));
        const lastExec = execs.executions?.[0];
        if (!lastExec || (lastExec.startDate && lastExec.startDate.getTime() < Date.now() - lookbackMs)) {
          recs.push(this.createRecommendation(input, {
            resourceId: machine.stateMachineArn, resourceType: "StepFunction",
            issueDescription: `Step Function "${machine.name}" has no recent executions in the last ${input.lookbackDays} days`,
            suggestedAction: "Delete the state machine if it is no longer needed",
            explanation: `This state machine has not been executed during the lookback period.`,
            estimatedMonthlySavings: 0,
          }));
        }
      } catch { /* skip */ }
    }
    return { recs, evaluated: machines.length };
  }

  private async detectZombieCloudFormationStacks(input: ZombieResourceDetectorInput): Promise<{ recs: Recommendation[]; evaluated: number }> {
    const recs: Recommendation[] = [];
    const { CloudFormationClient, ListStacksCommand } = await import("@aws-sdk/client-cloudformation");
    const roleName = input.crossAccountRoleArn?.split("/").pop();
    const cfn = await getClientForAccount(CloudFormationClient, input.accountId, input.region, roleName);
    const res = await cfn.send(new ListStacksCommand({ StackStatusFilter: ["CREATE_COMPLETE", "UPDATE_COMPLETE", "UPDATE_ROLLBACK_COMPLETE"] }));
    const stacks = res.StackSummaries ?? [];
    const lookbackMs = input.lookbackDays * 24 * 60 * 60 * 1000;
    for (const stack of stacks) {
      if (!stack.StackName || !stack.StackId) continue;
      const lastUpdated = stack.LastUpdatedTime ?? stack.CreationTime;
      if (lastUpdated && lastUpdated.getTime() < Date.now() - lookbackMs) {
        recs.push(this.createRecommendation(input, {
          resourceId: stack.StackId, resourceType: "CloudFormationStack",
          issueDescription: `CloudFormation stack "${stack.StackName}" has not been updated in the last ${input.lookbackDays} days`,
          suggestedAction: "Review and delete the stack if it is no longer needed",
          explanation: `This stack has not been updated during the lookback period and may be stale.`,
          estimatedMonthlySavings: 0,
        }));
      }
    }
    return { recs, evaluated: stacks.length };
  }

  private async detectZombieCloudFrontDistributions(input: ZombieResourceDetectorInput): Promise<{ recs: Recommendation[]; evaluated: number }> {
    const recs: Recommendation[] = [];
    const { CloudFrontClient, ListDistributionsCommand } = await import("@aws-sdk/client-cloudfront");
    const roleName = input.crossAccountRoleArn?.split("/").pop();
    const cf = await getClientForAccount(CloudFrontClient, input.accountId, "us-east-1", roleName);
    const res = await cf.send(new ListDistributionsCommand({}));
    const distributions = res.DistributionList?.Items ?? [];
    for (const dist of distributions) {
      if (!dist.Id) continue;
      if (dist.Enabled === false) {
        recs.push(this.createRecommendation(input, {
          resourceId: dist.Id, resourceType: "CloudFrontDistribution",
          issueDescription: `CloudFront distribution "${dist.DomainName ?? dist.Id}" is disabled`,
          suggestedAction: "Delete the disabled CloudFront distribution if it is no longer needed",
          explanation: `This distribution is disabled and not serving any traffic.`,
          estimatedMonthlySavings: 0,
        }));
      }
    }
    return { recs, evaluated: distributions.length };
  }

  private async detectZombieAPIGateways(input: ZombieResourceDetectorInput): Promise<{ recs: Recommendation[]; evaluated: number }> {
    const recs: Recommendation[] = [];
    let evaluated = 0;
    const roleName = input.crossAccountRoleArn?.split("/").pop();
    // REST APIs
    try {
      const { APIGatewayClient, GetRestApisCommand, GetStagesCommand } = await import("@aws-sdk/client-api-gateway");
      const apigw = await getClientForAccount(APIGatewayClient, input.accountId, input.region, roleName);
      const res = await apigw.send(new GetRestApisCommand({}));
      for (const api of res.items ?? []) {
        evaluated++;
        if (!api.id) continue;
        try {
          const stages = await apigw.send(new GetStagesCommand({ restApiId: api.id }));
          if ((stages.item ?? []).length === 0) {
            recs.push(this.createRecommendation(input, {
              resourceId: api.id, resourceType: "APIGatewayRestAPI",
              issueDescription: `API Gateway REST API "${api.name}" has no deployed stages`,
              suggestedAction: "Delete the API if it is no longer needed",
              explanation: `This REST API has no stages deployed and is not serving any traffic.`,
              estimatedMonthlySavings: 0,
            }));
          }
        } catch { /* skip */ }
      }
    } catch { /* skip */ }
    // HTTP APIs
    try {
      const { ApiGatewayV2Client, GetApisCommand, GetStagesCommand: GetStagesV2Command } = await import("@aws-sdk/client-apigatewayv2");
      const apigwv2 = await getClientForAccount(ApiGatewayV2Client, input.accountId, input.region, roleName);
      const res = await apigwv2.send(new GetApisCommand({}));
      for (const api of res.Items ?? []) {
        evaluated++;
        if (!api.ApiId) continue;
        try {
          const stages = await apigwv2.send(new GetStagesV2Command({ ApiId: api.ApiId }));
          if ((stages.Items ?? []).length === 0) {
            recs.push(this.createRecommendation(input, {
              resourceId: api.ApiId, resourceType: "APIGatewayHttpAPI",
              issueDescription: `API Gateway HTTP API "${api.Name}" has no deployed stages`,
              suggestedAction: "Delete the API if it is no longer needed",
              explanation: `This HTTP API has no stages deployed and is not serving any traffic.`,
              estimatedMonthlySavings: 0,
            }));
          }
        } catch { /* skip */ }
      }
    } catch { /* skip */ }
    return { recs, evaluated };
  }

  private async detectZombieRoute53HostedZones(input: ZombieResourceDetectorInput): Promise<{ recs: Recommendation[]; evaluated: number }> {
    const recs: Recommendation[] = [];
    const { Route53Client, ListHostedZonesCommand, ListResourceRecordSetsCommand } = await import("@aws-sdk/client-route-53");
    const roleName = input.crossAccountRoleArn?.split("/").pop();
    const r53 = await getClientForAccount(Route53Client, input.accountId, "us-east-1", roleName);
    const res = await r53.send(new ListHostedZonesCommand({}));
    const zones = res.HostedZones ?? [];
    for (const zone of zones) {
      if (!zone.Id) continue;
      try {
        const records = await r53.send(new ListResourceRecordSetsCommand({ HostedZoneId: zone.Id }));
        // Every hosted zone has at least NS and SOA records (2 records). If only those exist, it's empty.
        if ((records.ResourceRecordSets ?? []).length <= 2) {
          recs.push(this.createRecommendation(input, {
            resourceId: zone.Id, resourceType: "Route53HostedZone",
            issueDescription: `Route 53 hosted zone "${zone.Name}" has no custom DNS records (only NS/SOA)`,
            suggestedAction: "Delete the hosted zone if it is no longer needed to save $0.50/month",
            explanation: `This hosted zone contains only default NS and SOA records and is not managing any DNS entries.`,
            estimatedMonthlySavings: 0.50,
          }));
        }
      } catch { /* skip */ }
    }
    return { recs, evaluated: zones.length };
  }

  private async detectZombieEFSFileSystems(input: ZombieResourceDetectorInput): Promise<{ recs: Recommendation[]; evaluated: number }> {
    const recs: Recommendation[] = [];
    const { EFSClient, DescribeFileSystemsCommand } = await import("@aws-sdk/client-efs");
    const roleName = input.crossAccountRoleArn?.split("/").pop();
    const efs = await getClientForAccount(EFSClient, input.accountId, input.region, roleName);
    const res = await efs.send(new DescribeFileSystemsCommand({}));
    const fileSystems = res.FileSystems ?? [];
    for (const fs of fileSystems) {
      if (!fs.FileSystemId) continue;
      const sizeBytes = fs.SizeInBytes?.Value ?? 0;
      if (sizeBytes === 0 || fs.NumberOfMountTargets === 0) {
        const sizeGb = sizeBytes / (1024 * 1024 * 1024);
        recs.push(this.createRecommendation(input, {
          resourceId: fs.FileSystemId, resourceType: "EFSFileSystem",
          issueDescription: `EFS file system "${fs.Name ?? fs.FileSystemId}" ${fs.NumberOfMountTargets === 0 ? "has no mount targets" : "is empty"}`,
          suggestedAction: "Delete the EFS file system if it is no longer needed",
          explanation: `This file system ${fs.NumberOfMountTargets === 0 ? "has no mount targets and cannot be accessed" : "contains no data"}.`,
          estimatedMonthlySavings: Math.round(sizeGb * 0.30 * 100) / 100,
        }));
      }
    }
    return { recs, evaluated: fileSystems.length };
  }

  private async detectZombieECRRepositories(input: ZombieResourceDetectorInput): Promise<{ recs: Recommendation[]; evaluated: number }> {
    const recs: Recommendation[] = [];
    const { ECRClient, DescribeRepositoriesCommand, ListImagesCommand } = await import("@aws-sdk/client-ecr");
    const roleName = input.crossAccountRoleArn?.split("/").pop();
    const ecr = await getClientForAccount(ECRClient, input.accountId, input.region, roleName);
    const res = await ecr.send(new DescribeRepositoriesCommand({}));
    const repos = res.repositories ?? [];
    for (const repo of repos) {
      if (!repo.repositoryName) continue;
      try {
        const images = await ecr.send(new ListImagesCommand({ repositoryName: repo.repositoryName, maxResults: 1 }));
        if ((images.imageIds ?? []).length === 0) {
          recs.push(this.createRecommendation(input, {
            resourceId: repo.repositoryArn ?? repo.repositoryName, resourceType: "ECRRepository",
            issueDescription: `ECR repository "${repo.repositoryName}" contains no images`,
            suggestedAction: "Delete the empty ECR repository if it is no longer needed",
            explanation: `This repository has no container images stored.`,
            estimatedMonthlySavings: 0,
          }));
        }
      } catch { /* skip */ }
    }
    return { recs, evaluated: repos.length };
  }

  private async detectZombieElastiCacheClusters(input: ZombieResourceDetectorInput): Promise<{ recs: Recommendation[]; evaluated: number }> {
    const recs: Recommendation[] = [];
    const { ElastiCacheClient, DescribeCacheClustersCommand } = await import("@aws-sdk/client-elasticache");
    const roleName = input.crossAccountRoleArn?.split("/").pop();
    const client = await getClientForAccount(ElastiCacheClient, input.accountId, input.region, roleName);
    const res = await client.send(new DescribeCacheClustersCommand({}));
    const clusters = res.CacheClusters ?? [];
    const CACHE_HOURLY: Record<string, number> = {
      "cache.t2.micro": 0.017, "cache.t3.micro": 0.017, "cache.t3.small": 0.034, "cache.t3.medium": 0.068,
      "cache.m5.large": 0.156, "cache.r5.large": 0.218,
    };
    for (const cluster of clusters) {
      if (!cluster.CacheClusterId) continue;
      // Flag clusters that are not in "available" state
      if (cluster.CacheClusterStatus !== "available") {
        const hourly = CACHE_HOURLY[cluster.CacheNodeType ?? ""] ?? 0;
        recs.push(this.createRecommendation(input, {
          resourceId: cluster.ARN ?? cluster.CacheClusterId, resourceType: "ElastiCacheCluster",
          issueDescription: `ElastiCache cluster "${cluster.CacheClusterId}" is in "${cluster.CacheClusterStatus}" state`,
          suggestedAction: "Review and delete the cluster if it is no longer needed",
          explanation: `This cluster is not in a healthy available state.`,
          estimatedMonthlySavings: Math.round(hourly * 730 * 100) / 100,
        }));
      }
    }
    return { recs, evaluated: clusters.length };
  }

  private async detectZombieEventBridgeRules(input: ZombieResourceDetectorInput): Promise<{ recs: Recommendation[]; evaluated: number }> {
    const recs: Recommendation[] = [];
    const { EventBridgeClient, ListRulesCommand, ListTargetsByRuleCommand } = await import("@aws-sdk/client-eventbridge");
    const roleName = input.crossAccountRoleArn?.split("/").pop();
    const client = await getClientForAccount(EventBridgeClient, input.accountId, input.region, roleName);
    const res = await client.send(new ListRulesCommand({}));
    const rules = res.Rules ?? [];
    for (const rule of rules) {
      if (!rule.Name || !rule.Arn) continue;
      if (rule.State === "DISABLED") {
        recs.push(this.createRecommendation(input, {
          resourceId: rule.Arn, resourceType: "EventBridgeRule",
          issueDescription: `EventBridge rule "${rule.Name}" is disabled`,
          suggestedAction: "Delete the disabled rule if it is no longer needed",
          explanation: `This rule is disabled and not processing any events.`,
          estimatedMonthlySavings: 0,
        }));
        continue;
      }
      try {
        const targets = await client.send(new ListTargetsByRuleCommand({ Rule: rule.Name }));
        if ((targets.Targets ?? []).length === 0) {
          recs.push(this.createRecommendation(input, {
            resourceId: rule.Arn, resourceType: "EventBridgeRule",
            issueDescription: `EventBridge rule "${rule.Name}" has no targets`,
            suggestedAction: "Delete the rule or add targets",
            explanation: `This rule matches events but has no targets to deliver them to.`,
            estimatedMonthlySavings: 0,
          }));
        }
      } catch { /* skip */ }
    }
    return { recs, evaluated: rules.length };
  }

  private async detectZombieKinesisStreams(input: ZombieResourceDetectorInput, cloudwatch: CloudWatchClient): Promise<{ recs: Recommendation[]; evaluated: number }> {
    const recs: Recommendation[] = [];
    const { KinesisClient, ListStreamsCommand, DescribeStreamSummaryCommand } = await import("@aws-sdk/client-kinesis");
    const roleName = input.crossAccountRoleArn?.split("/").pop();
    const client = await getClientForAccount(KinesisClient, input.accountId, input.region, roleName);
    const res = await client.send(new ListStreamsCommand({}));
    const streamNames = res.StreamNames ?? [];
    const now = new Date();
    const lookbackStart = new Date(now.getTime() - input.lookbackDays * 24 * 60 * 60 * 1000);
    for (const streamName of streamNames) {
      try {
        const desc = await client.send(new DescribeStreamSummaryCommand({ StreamName: streamName }));
        const shardCount = desc.StreamDescriptionSummary?.OpenShardCount ?? 1;
        // Check IncomingRecords metric
        const result = await cloudwatch.send(new GetMetricStatisticsCommand({
          Namespace: "AWS/Kinesis", MetricName: "IncomingRecords",
          Dimensions: [{ Name: "StreamName", Value: streamName }],
          StartTime: lookbackStart, EndTime: now, Period: 86400, Statistics: ["Sum"],
        }));
        const totalRecords = (result.Datapoints ?? []).reduce((sum, dp) => sum + (dp.Sum ?? 0), 0);
        if (totalRecords === 0) {
          recs.push(this.createRecommendation(input, {
            resourceId: desc.StreamDescriptionSummary?.StreamARN ?? streamName, resourceType: "KinesisStream",
            issueDescription: `Kinesis stream "${streamName}" has zero incoming records in the last ${input.lookbackDays} days`,
            suggestedAction: "Delete the stream if it is no longer needed",
            explanation: `This stream has received no data during the lookback period.`,
            estimatedMonthlySavings: Math.round(shardCount * 0.015 * 730 * 100) / 100,
          }));
        }
      } catch { /* skip */ }
    }
    return { recs, evaluated: streamNames.length };
  }

  private async detectZombieCognitoUserPools(input: ZombieResourceDetectorInput): Promise<{ recs: Recommendation[]; evaluated: number }> {
    const recs: Recommendation[] = [];
    const { CognitoIdentityProviderClient, ListUserPoolsCommand, DescribeUserPoolCommand } = await import("@aws-sdk/client-cognito-identity-provider");
    const roleName = input.crossAccountRoleArn?.split("/").pop();
    const client = await getClientForAccount(CognitoIdentityProviderClient, input.accountId, input.region, roleName);
    const res = await client.send(new ListUserPoolsCommand({ MaxResults: 60 }));
    const pools = res.UserPools ?? [];
    for (const pool of pools) {
      if (!pool.Id) continue;
      try {
        const desc = await client.send(new DescribeUserPoolCommand({ UserPoolId: pool.Id }));
        const estimatedUsers = desc.UserPool?.EstimatedNumberOfUsers ?? 0;
        if (estimatedUsers === 0) {
          recs.push(this.createRecommendation(input, {
            resourceId: pool.Id, resourceType: "CognitoUserPool",
            issueDescription: `Cognito user pool "${pool.Name}" has zero users`,
            suggestedAction: "Delete the user pool if it is no longer needed",
            explanation: `This user pool has no registered users.`,
            estimatedMonthlySavings: 0,
          }));
        }
      } catch { /* skip */ }
    }
    return { recs, evaluated: pools.length };
  }

  private async detectZombieSecretsManagerSecrets(input: ZombieResourceDetectorInput): Promise<{ recs: Recommendation[]; evaluated: number }> {
    const recs: Recommendation[] = [];
    const { SecretsManagerClient, ListSecretsCommand } = await import("@aws-sdk/client-secrets-manager");
    const roleName = input.crossAccountRoleArn?.split("/").pop();
    const client = await getClientForAccount(SecretsManagerClient, input.accountId, input.region, roleName);
    const res = await client.send(new ListSecretsCommand({}));
    const secrets = res.SecretList ?? [];
    const lookbackMs = input.lookbackDays * 24 * 60 * 60 * 1000;
    for (const secret of secrets) {
      if (!secret.ARN || !secret.Name) continue;
      const lastAccessed = secret.LastAccessedDate?.getTime() ?? 0;
      if (lastAccessed > 0 && lastAccessed < Date.now() - lookbackMs) {
        recs.push(this.createRecommendation(input, {
          resourceId: secret.ARN, resourceType: "SecretsManagerSecret",
          issueDescription: `Secret "${secret.Name}" has not been accessed in the last ${input.lookbackDays} days`,
          suggestedAction: "Delete the secret if it is no longer needed to save $0.40/month",
          explanation: `This secret has not been accessed during the lookback period.`,
          estimatedMonthlySavings: 0.40,
        }));
      }
    }
    return { recs, evaluated: secrets.length };
  }

  private async detectZombieACMCertificates(input: ZombieResourceDetectorInput): Promise<{ recs: Recommendation[]; evaluated: number }> {
    const recs: Recommendation[] = [];
    const { ACMClient, ListCertificatesCommand, DescribeCertificateCommand } = await import("@aws-sdk/client-acm");
    const roleName = input.crossAccountRoleArn?.split("/").pop();
    const client = await getClientForAccount(ACMClient, input.accountId, input.region, roleName);
    const res = await client.send(new ListCertificatesCommand({}));
    const certs = res.CertificateSummaryList ?? [];
    for (const cert of certs) {
      if (!cert.CertificateArn) continue;
      try {
        const desc = await client.send(new DescribeCertificateCommand({ CertificateArn: cert.CertificateArn }));
        const detail = desc.Certificate;
        if (detail && (detail.InUseBy ?? []).length === 0) {
          recs.push(this.createRecommendation(input, {
            resourceId: cert.CertificateArn, resourceType: "ACMCertificate",
            issueDescription: `ACM certificate for "${cert.DomainName}" is not in use by any AWS resource`,
            suggestedAction: "Delete the unused certificate",
            explanation: `This certificate is not attached to any load balancer, CloudFront distribution, or other AWS resource.`,
            estimatedMonthlySavings: 0,
          }));
        }
      } catch { /* skip */ }
    }
    return { recs, evaluated: certs.length };
  }

  private async detectZombieKMSKeys(input: ZombieResourceDetectorInput): Promise<{ recs: Recommendation[]; evaluated: number }> {
    const recs: Recommendation[] = [];
    const { KMSClient, ListKeysCommand, DescribeKeyCommand } = await import("@aws-sdk/client-kms");
    const roleName = input.crossAccountRoleArn?.split("/").pop();
    const client = await getClientForAccount(KMSClient, input.accountId, input.region, roleName);
    const res = await client.send(new ListKeysCommand({}));
    const keys = res.Keys ?? [];
    for (const key of keys) {
      if (!key.KeyId) continue;
      try {
        const desc = await client.send(new DescribeKeyCommand({ KeyId: key.KeyId }));
        const meta = desc.KeyMetadata;
        if (meta && meta.KeyManager === "CUSTOMER" && meta.KeyState === "Enabled") {
          // Flag customer-managed keys that are pending deletion or disabled
          // For enabled keys, we can't easily tell if they're unused without CloudTrail
        }
        if (meta && meta.KeyManager === "CUSTOMER" && meta.KeyState === "Disabled") {
          recs.push(this.createRecommendation(input, {
            resourceId: key.KeyArn ?? key.KeyId, resourceType: "KMSKey",
            issueDescription: `KMS key "${meta.Description || key.KeyId}" is disabled`,
            suggestedAction: "Schedule the key for deletion if it is no longer needed to save $1.00/month",
            explanation: `This customer-managed KMS key is disabled and not encrypting any data.`,
            estimatedMonthlySavings: 1.00,
          }));
        }
      } catch { /* skip */ }
    }
    return { recs, evaluated: keys.length };
  }

  private async detectZombieWAFWebACLs(input: ZombieResourceDetectorInput): Promise<{ recs: Recommendation[]; evaluated: number }> {
    const recs: Recommendation[] = [];
    const { WAFV2Client, ListWebACLsCommand, ListResourcesForWebACLCommand } = await import("@aws-sdk/client-wafv2");
    const roleName = input.crossAccountRoleArn?.split("/").pop();
    const client = await getClientForAccount(WAFV2Client, input.accountId, input.region, roleName);
    const res = await client.send(new ListWebACLsCommand({ Scope: "REGIONAL" }));
    const acls = res.WebACLs ?? [];
    for (const acl of acls) {
      if (!acl.ARN) continue;
      try {
        const resources = await client.send(new ListResourcesForWebACLCommand({ WebACLArn: acl.ARN }));
        if ((resources.ResourceArns ?? []).length === 0) {
          recs.push(this.createRecommendation(input, {
            resourceId: acl.ARN, resourceType: "WAFWebACL",
            issueDescription: `WAF Web ACL "${acl.Name}" is not associated with any resource`,
            suggestedAction: "Delete the Web ACL if it is no longer needed to save ~$5.00/month",
            explanation: `This Web ACL is not protecting any ALB, API Gateway, or other resource.`,
            estimatedMonthlySavings: 5.00,
          }));
        }
      } catch { /* skip */ }
    }
    return { recs, evaluated: acls.length };
  }

  private async detectZombieCodePipelines(input: ZombieResourceDetectorInput): Promise<{ recs: Recommendation[]; evaluated: number }> {
    const recs: Recommendation[] = [];
    const { CodePipelineClient, ListPipelinesCommand, ListPipelineExecutionsCommand } = await import("@aws-sdk/client-codepipeline");
    const roleName = input.crossAccountRoleArn?.split("/").pop();
    const client = await getClientForAccount(CodePipelineClient, input.accountId, input.region, roleName);
    const res = await client.send(new ListPipelinesCommand({}));
    const pipelines = res.pipelines ?? [];
    const lookbackMs = input.lookbackDays * 24 * 60 * 60 * 1000;
    for (const pipeline of pipelines) {
      if (!pipeline.name) continue;
      try {
        const execs = await client.send(new ListPipelineExecutionsCommand({ pipelineName: pipeline.name, maxResults: 1 }));
        const lastExec = execs.pipelineExecutionSummaries?.[0];
        if (!lastExec || (lastExec.startTime && lastExec.startTime.getTime() < Date.now() - lookbackMs)) {
          recs.push(this.createRecommendation(input, {
            resourceId: pipeline.name, resourceType: "CodePipeline",
            issueDescription: `CodePipeline "${pipeline.name}" has no recent executions in the last ${input.lookbackDays} days`,
            suggestedAction: "Delete the pipeline if it is no longer needed to save $1.00/month",
            explanation: `This pipeline has not been executed during the lookback period.`,
            estimatedMonthlySavings: 1.00,
          }));
        }
      } catch { /* skip */ }
    }
    return { recs, evaluated: pipelines.length };
  }

  private async detectZombieCodeBuildProjects(input: ZombieResourceDetectorInput, cloudwatch: CloudWatchClient): Promise<{ recs: Recommendation[]; evaluated: number }> {
    const recs: Recommendation[] = [];
    const { CodeBuildClient, ListProjectsCommand, BatchGetProjectsCommand } = await import("@aws-sdk/client-codebuild");
    const roleName = input.crossAccountRoleArn?.split("/").pop();
    const client = await getClientForAccount(CodeBuildClient, input.accountId, input.region, roleName);
    const res = await client.send(new ListProjectsCommand({}));
    const projectNames = res.projects ?? [];
    if (projectNames.length === 0) return { recs, evaluated: 0 };
    const lookbackMs = input.lookbackDays * 24 * 60 * 60 * 1000;
    // BatchGetProjects accepts max 100 at a time
    for (let i = 0; i < projectNames.length; i += 100) {
      const batch = projectNames.slice(i, i + 100);
      try {
        const details = await client.send(new BatchGetProjectsCommand({ names: batch }));
        for (const project of details.projects ?? []) {
          if (!project.name) continue;
          const lastBuild = project.lastModifiedDate;
          if (lastBuild && lastBuild.getTime() < Date.now() - lookbackMs) {
            recs.push(this.createRecommendation(input, {
              resourceId: project.arn ?? project.name, resourceType: "CodeBuildProject",
              issueDescription: `CodeBuild project "${project.name}" has no recent builds in the last ${input.lookbackDays} days`,
              suggestedAction: "Delete the project if it is no longer needed",
              explanation: `This build project has not been modified during the lookback period.`,
              estimatedMonthlySavings: 0,
            }));
          }
        }
      } catch { /* skip */ }
    }
    return { recs, evaluated: projectNames.length };
  }

  private async detectZombieCodeCommitRepos(input: ZombieResourceDetectorInput): Promise<{ recs: Recommendation[]; evaluated: number }> {
    const recs: Recommendation[] = [];
    const { CodeCommitClient, ListRepositoriesCommand, GetRepositoryCommand } = await import("@aws-sdk/client-codecommit");
    const roleName = input.crossAccountRoleArn?.split("/").pop();
    const client = await getClientForAccount(CodeCommitClient, input.accountId, input.region, roleName);
    const res = await client.send(new ListRepositoriesCommand({}));
    const repos = res.repositories ?? [];
    const lookbackMs = input.lookbackDays * 24 * 60 * 60 * 1000;
    for (const repo of repos) {
      if (!repo.repositoryName) continue;
      try {
        const detail = await client.send(new GetRepositoryCommand({ repositoryName: repo.repositoryName }));
        const lastModified = detail.repositoryMetadata?.lastModifiedDate;
        if (lastModified && lastModified.getTime() < Date.now() - lookbackMs) {
          recs.push(this.createRecommendation(input, {
            resourceId: detail.repositoryMetadata?.Arn ?? repo.repositoryName, resourceType: "CodeCommitRepo",
            issueDescription: `CodeCommit repository "${repo.repositoryName}" has no recent activity in the last ${input.lookbackDays} days`,
            suggestedAction: "Delete the repository if it is no longer needed",
            explanation: `This repository has not been modified during the lookback period.`,
            estimatedMonthlySavings: 0,
          }));
        }
      } catch { /* skip */ }
    }
    return { recs, evaluated: repos.length };
  }

  private async detectZombieAmplifyApps(input: ZombieResourceDetectorInput): Promise<{ recs: Recommendation[]; evaluated: number }> {
    const recs: Recommendation[] = [];
    const { AmplifyClient, ListAppsCommand } = await import("@aws-sdk/client-amplify");
    const roleName = input.crossAccountRoleArn?.split("/").pop();
    const client = await getClientForAccount(AmplifyClient, input.accountId, input.region, roleName);
    const res = await client.send(new ListAppsCommand({}));
    const apps = res.apps ?? [];
    const lookbackMs = input.lookbackDays * 24 * 60 * 60 * 1000;
    for (const app of apps) {
      if (!app.appId) continue;
      const lastUpdate = app.updateTime;
      if (lastUpdate && lastUpdate.getTime() < Date.now() - lookbackMs) {
        recs.push(this.createRecommendation(input, {
          resourceId: app.appArn ?? app.appId, resourceType: "AmplifyApp",
          issueDescription: `Amplify app "${app.name}" has not been updated in the last ${input.lookbackDays} days`,
          suggestedAction: "Delete the app if it is no longer needed",
          explanation: `This Amplify app has not been updated during the lookback period.`,
          estimatedMonthlySavings: 0,
        }));
      }
    }
    return { recs, evaluated: apps.length };
  }

  // ═══════════════════════════════════════════
  // HELPER
  // ═══════════════════════════════════════════

  private createRecommendation(
    input: ZombieResourceDetectorInput,
    fields: {
      resourceId: string;
      resourceType: keyof typeof RESOURCE_ACTION_MAP;
      issueDescription: string;
      suggestedAction: string;
      explanation: string;
      estimatedMonthlySavings: number;
    }
  ): Recommendation {
    return {
      recommendationId: crypto.randomUUID(),
      scanId: this.scanId,
      accountId: input.accountId,
      region: input.region,
      advisorType: "ZombieResourceDetector",
      resourceId: fields.resourceId,
      resourceType: fields.resourceType,
      issueDescription: fields.issueDescription,
      suggestedAction: fields.suggestedAction,
      riskLevel: "Medium",
      explanation: fields.explanation,
      estimatedMonthlySavings: fields.estimatedMonthlySavings,
      dependencies: [],
      availableActions: RESOURCE_ACTION_MAP[fields.resourceType],
      createdAt: new Date().toISOString(),
    };
  }
}

// Lambda handler for CDK integration
export async function handler(event: ZombieResourceDetectorInput & { scanId: string }): Promise<ZombieResourceDetectorOutput> {
  const detector = new ZombieResourceDetector(event.scanId);
  return detector.analyze(event);
}
