import { EC2Client, DescribeInstancesCommand, DescribeVolumesCommand, DescribeAddressesCommand, DescribeSecurityGroupsCommand, DescribeNatGatewaysCommand, DescribeVpcsCommand, DescribeSubnetsCommand, DescribeInternetGatewaysCommand } from "@aws-sdk/client-ec2";
import { LambdaClient, ListFunctionsCommand, ListLayersCommand } from "@aws-sdk/client-lambda";
import { IAMClient, ListRolesCommand, ListUsersCommand, ListPoliciesCommand, ListGroupsCommand } from "@aws-sdk/client-iam";
import { RDSClient, DescribeDBInstancesCommand, DescribeDBClustersCommand } from "@aws-sdk/client-rds";
import { ECSClient, ListClustersCommand, ListServicesCommand } from "@aws-sdk/client-ecs";
import { ElasticLoadBalancingV2Client, DescribeLoadBalancersCommand, DescribeTargetGroupsCommand } from "@aws-sdk/client-elastic-load-balancing-v2";
import { CloudWatchLogsClient, DescribeLogGroupsCommand } from "@aws-sdk/client-cloudwatch-logs";
import { S3Client, ListBucketsCommand } from "@aws-sdk/client-s3";
import { DynamoDBClient, ListTablesCommand } from "@aws-sdk/client-dynamodb";
import { SFNClient, ListStateMachinesCommand } from "@aws-sdk/client-sfn";
import { CloudFormationClient, ListStacksCommand } from "@aws-sdk/client-cloudformation";
import { SNSClient, ListTopicsCommand, ListSubscriptionsCommand } from "@aws-sdk/client-sns";
import { SQSClient, ListQueuesCommand } from "@aws-sdk/client-sqs";

export interface ServiceResource {
  name: string;
  id: string;
  status?: string;
  details?: string;
  estimatedMonthlyCost?: number;
  createdAt?: string;
  stale?: boolean;
  staleDays?: number;
}

export interface ServiceCategory {
  category: string;
  icon: string;
  services: {
    serviceName: string;
    icon: string;
    count: number;
    resources: ServiceResource[];
    estimatedMonthlyCost?: number;
  }[];
  estimatedMonthlyCost?: number;
}

type SvcEntry = ServiceCategory["services"][number];

async function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  try { return await fn(); } catch { return null; }
}

export async function discoverActiveServices(region: string): Promise<ServiceCategory[]> {
  const categories: ServiceCategory[] = [];

  // ═══════════════════════════════════════════
  // COMPUTE
  // ═══════════════════════════════════════════
  const compute: SvcEntry[] = [];

  // EC2 Instances
  await safe(async () => {
    const ec2 = new EC2Client({ region });
    const res = await ec2.send(new DescribeInstancesCommand({}));
    const items: ServiceResource[] = [];
    for (const r of res.Reservations ?? []) {
      for (const i of r.Instances ?? []) {
        const launchTime = i.LaunchTime?.toISOString() ?? "";
        const instanceType = i.InstanceType ?? "unknown";
        const platform = i.Platform === "Windows" ? "Windows" : "Linux";
        items.push({
          name: i.Tags?.find(t => t.Key === "Name")?.Value ?? i.InstanceId ?? "",
          id: i.InstanceId ?? "",
          status: i.State?.Name,
          details: JSON.stringify({ instanceType, platform, launchTime }),
          createdAt: launchTime,
        });
      }
    }
    if (items.length) compute.push({ serviceName: "EC2 Instances", icon: "🖥️", count: items.length, resources: items });
  });

  // Lambda Functions
  await safe(async () => {
    const client = new LambdaClient({ region });
    const items: ServiceResource[] = [];
    let marker: string | undefined;
    do {
      const res = await client.send(new ListFunctionsCommand({ Marker: marker }));
      for (const f of res.Functions ?? []) items.push({ name: f.FunctionName ?? "", id: f.FunctionArn ?? "", status: "Active", details: `${f.Runtime ?? "N/A"} · ${f.MemorySize}MB`, createdAt: f.LastModified ?? "" });
      marker = res.NextMarker;
    } while (marker);
    if (items.length) compute.push({ serviceName: "Lambda Functions", icon: "⚡", count: items.length, resources: items });
  });

  // Lambda Layers
  await safe(async () => {
    const client = new LambdaClient({ region });
    const res = await client.send(new ListLayersCommand({}));
    const items = (res.Layers ?? []).map(l => ({ name: l.LayerName ?? "", id: l.LayerArn ?? "", details: `v${l.LatestMatchingVersion?.Version ?? "?"}` }));
    if (items.length) compute.push({ serviceName: "Lambda Layers", icon: "📦", count: items.length, resources: items });
  });

  // ECS Clusters
  await safe(async () => {
    const client = new ECSClient({ region });
    const clusters = await client.send(new ListClustersCommand({}));
    const items: ServiceResource[] = [];
    for (const arn of clusters.clusterArns ?? []) {
      const svcs = await client.send(new ListServicesCommand({ cluster: arn }));
      items.push({ name: arn.split("/").pop() ?? "", id: arn, status: "Active", details: `${svcs.serviceArns?.length ?? 0} service(s)` });
    }
    if (items.length) compute.push({ serviceName: "ECS Clusters", icon: "🐳", count: items.length, resources: items });
  });

  // Auto Scaling Groups
  await safe(async () => {
    const { AutoScalingClient, DescribeAutoScalingGroupsCommand } = await import("@aws-sdk/client-auto-scaling");
    const client = new AutoScalingClient({ region });
    const res = await client.send(new DescribeAutoScalingGroupsCommand({}));
    const items = (res.AutoScalingGroups ?? []).map(g => ({ name: g.AutoScalingGroupName ?? "", id: g.AutoScalingGroupARN ?? "", status: `${g.DesiredCapacity} desired`, details: `Min:${g.MinSize} Max:${g.MaxSize}` }));
    if (items.length) compute.push({ serviceName: "Auto Scaling Groups", icon: "📐", count: items.length, resources: items });
  });

  if (compute.length) categories.push({ category: "Compute", icon: "🖥️", services: compute });

  // ═══════════════════════════════════════════
  // STORAGE
  // ═══════════════════════════════════════════
  const storage: SvcEntry[] = [];

  // S3 Buckets
  await safe(async () => {
    const client = new S3Client({ region });
    const res = await client.send(new ListBucketsCommand({}));
    const items = (res.Buckets ?? []).map(b => ({ name: b.Name ?? "", id: b.Name ?? "", status: "Active", details: `Created ${b.CreationDate?.toISOString().split("T")[0] ?? ""}`, createdAt: b.CreationDate?.toISOString() ?? "" }));
    if (items.length) storage.push({ serviceName: "S3 Buckets", icon: "🪣", count: items.length, resources: items });
  });

  // EBS Volumes
  await safe(async () => {
    const ec2 = new EC2Client({ region });
    const res = await ec2.send(new DescribeVolumesCommand({}));
    const items = (res.Volumes ?? []).map(v => ({
      name: v.Tags?.find(t => t.Key === "Name")?.Value ?? v.VolumeId ?? "",
      id: v.VolumeId ?? "",
      status: v.State,
      details: JSON.stringify({ sizeGB: v.Size ?? 0, volumeType: v.VolumeType ?? "gp3", iops: v.Iops, createTime: v.CreateTime?.toISOString() }),
      createdAt: v.CreateTime?.toISOString() ?? "",
    }));
    if (items.length) storage.push({ serviceName: "EBS Volumes", icon: "💾", count: items.length, resources: items });
  });

  // EFS File Systems
  await safe(async () => {
    const { EFSClient, DescribeFileSystemsCommand } = await import("@aws-sdk/client-efs");
    const client = new EFSClient({ region });
    const res = await client.send(new DescribeFileSystemsCommand({}));
    const items = (res.FileSystems ?? []).map(f => ({ name: f.Name ?? f.FileSystemId ?? "", id: f.FileSystemId ?? "", status: f.LifeCycleState, details: `${((f.SizeInBytes?.Value ?? 0) / 1024 / 1024).toFixed(1)}MB` }));
    if (items.length) storage.push({ serviceName: "EFS File Systems", icon: "📁", count: items.length, resources: items });
  });

  // ECR Repositories
  await safe(async () => {
    const { ECRClient, DescribeRepositoriesCommand } = await import("@aws-sdk/client-ecr");
    const client = new ECRClient({ region });
    const res = await client.send(new DescribeRepositoriesCommand({}));
    const items = (res.repositories ?? []).map(r => ({ name: r.repositoryName ?? "", id: r.repositoryArn ?? "", details: r.repositoryUri }));
    if (items.length) storage.push({ serviceName: "ECR Repositories", icon: "📦", count: items.length, resources: items });
  });

  if (storage.length) categories.push({ category: "Storage", icon: "💾", services: storage });

  // ═══════════════════════════════════════════
  // DATABASE
  // ═══════════════════════════════════════════
  const database: SvcEntry[] = [];

  // DynamoDB Tables
  await safe(async () => {
    const client = new DynamoDBClient({ region });
    const res = await client.send(new ListTablesCommand({}));
    const items = (res.TableNames ?? []).map(t => ({ name: t, id: t, status: "Active" }));
    if (items.length) database.push({ serviceName: "DynamoDB Tables", icon: "📋", count: items.length, resources: items });
  });

  // RDS Instances
  await safe(async () => {
    const client = new RDSClient({ region });
    const res = await client.send(new DescribeDBInstancesCommand({}));
    const items = (res.DBInstances ?? []).map(d => ({
      name: d.DBInstanceIdentifier ?? "",
      id: d.DBInstanceArn ?? "",
      status: d.DBInstanceStatus,
      details: JSON.stringify({ engine: d.Engine, instanceClass: d.DBInstanceClass, multiAZ: d.MultiAZ, storageGB: d.AllocatedStorage, storageType: d.StorageType }),
    }));
    if (items.length) database.push({ serviceName: "RDS Instances", icon: "🗄️", count: items.length, resources: items });
  });

  // RDS Clusters (Aurora)
  await safe(async () => {
    const client = new RDSClient({ region });
    const res = await client.send(new DescribeDBClustersCommand({}));
    const items = (res.DBClusters ?? []).map(c => ({ name: c.DBClusterIdentifier ?? "", id: c.DBClusterArn ?? "", status: c.Status, details: c.Engine }));
    if (items.length) database.push({ serviceName: "Aurora Clusters", icon: "🌟", count: items.length, resources: items });
  });

  // ElastiCache
  await safe(async () => {
    const { ElastiCacheClient, DescribeCacheClustersCommand } = await import("@aws-sdk/client-elasticache");
    const client = new ElastiCacheClient({ region });
    const res = await client.send(new DescribeCacheClustersCommand({}));
    const items = (res.CacheClusters ?? []).map(c => ({ name: c.CacheClusterId ?? "", id: c.ARN ?? "", status: c.CacheClusterStatus, details: `${c.Engine} · ${c.CacheNodeType}` }));
    if (items.length) database.push({ serviceName: "ElastiCache Clusters", icon: "⚡", count: items.length, resources: items });
  });

  if (database.length) categories.push({ category: "Database", icon: "🗄️", services: database });

  // ═══════════════════════════════════════════
  // NETWORKING & CONTENT DELIVERY
  // ═══════════════════════════════════════════
  const networking: SvcEntry[] = [];

  // VPCs
  await safe(async () => {
    const ec2 = new EC2Client({ region });
    const res = await ec2.send(new DescribeVpcsCommand({}));
    const items = (res.Vpcs ?? []).map(v => ({ name: v.Tags?.find(t => t.Key === "Name")?.Value ?? v.VpcId ?? "", id: v.VpcId ?? "", status: v.State, details: v.CidrBlock }));
    if (items.length) networking.push({ serviceName: "VPCs", icon: "🌐", count: items.length, resources: items });
  });

  // Subnets
  await safe(async () => {
    const ec2 = new EC2Client({ region });
    const res = await ec2.send(new DescribeSubnetsCommand({}));
    const items = (res.Subnets ?? []).map(s => ({ name: s.Tags?.find(t => t.Key === "Name")?.Value ?? s.SubnetId ?? "", id: s.SubnetId ?? "", details: `${s.CidrBlock} · AZ: ${s.AvailabilityZone}` }));
    if (items.length) networking.push({ serviceName: "Subnets", icon: "🔀", count: items.length, resources: items });
  });

  // Internet Gateways
  await safe(async () => {
    const ec2 = new EC2Client({ region });
    const res = await ec2.send(new DescribeInternetGatewaysCommand({}));
    const items = (res.InternetGateways ?? []).map(ig => ({ name: ig.Tags?.find(t => t.Key === "Name")?.Value ?? ig.InternetGatewayId ?? "", id: ig.InternetGatewayId ?? "", status: ig.Attachments?.length ? "Attached" : "Detached" }));
    if (items.length) networking.push({ serviceName: "Internet Gateways", icon: "🚀", count: items.length, resources: items });
  });

  // Load Balancers
  await safe(async () => {
    const client = new ElasticLoadBalancingV2Client({ region });
    const res = await client.send(new DescribeLoadBalancersCommand({}));
    const items = (res.LoadBalancers ?? []).map(l => ({ name: l.LoadBalancerName ?? "", id: l.LoadBalancerArn ?? "", status: l.State?.Code, details: l.Type }));
    if (items.length) networking.push({ serviceName: "Load Balancers", icon: "⚖️", count: items.length, resources: items });
  });

  // Target Groups
  await safe(async () => {
    const client = new ElasticLoadBalancingV2Client({ region });
    const res = await client.send(new DescribeTargetGroupsCommand({}));
    const items = (res.TargetGroups ?? []).map(tg => ({ name: tg.TargetGroupName ?? "", id: tg.TargetGroupArn ?? "", details: `${tg.Protocol} :${tg.Port} · ${tg.TargetType}` }));
    if (items.length) networking.push({ serviceName: "Target Groups", icon: "🎯", count: items.length, resources: items });
  });

  // Elastic IPs
  await safe(async () => {
    const ec2 = new EC2Client({ region });
    const res = await ec2.send(new DescribeAddressesCommand({}));
    const items = (res.Addresses ?? []).map(a => ({ name: a.PublicIp ?? "", id: a.AllocationId ?? "", status: a.AssociationId ? "Associated" : "Unassociated", details: a.InstanceId ?? "No instance" }));
    if (items.length) networking.push({ serviceName: "Elastic IPs", icon: "📍", count: items.length, resources: items });
  });

  // NAT Gateways
  await safe(async () => {
    const ec2 = new EC2Client({ region });
    const res = await ec2.send(new DescribeNatGatewaysCommand({}));
    const items = (res.NatGateways ?? []).filter(n => n.State !== "deleted").map(n => ({ name: n.Tags?.find(t => t.Key === "Name")?.Value ?? n.NatGatewayId ?? "", id: n.NatGatewayId ?? "", status: n.State }));
    if (items.length) networking.push({ serviceName: "NAT Gateways", icon: "🚪", count: items.length, resources: items });
  });

  // Security Groups
  await safe(async () => {
    const ec2 = new EC2Client({ region });
    const res = await ec2.send(new DescribeSecurityGroupsCommand({}));
    const items = (res.SecurityGroups ?? []).map(s => ({ name: s.GroupName ?? "", id: s.GroupId ?? "", details: s.Description }));
    if (items.length) networking.push({ serviceName: "Security Groups", icon: "🛡️", count: items.length, resources: items });
  });

  // CloudFront Distributions
  await safe(async () => {
    const { CloudFrontClient, ListDistributionsCommand } = await import("@aws-sdk/client-cloudfront");
    const client = new CloudFrontClient({ region: "us-east-1" });
    const res = await client.send(new ListDistributionsCommand({}));
    const items = (res.DistributionList?.Items ?? []).map(d => ({ name: d.DomainName ?? "", id: d.Id ?? "", status: d.Status, details: d.Origins?.Items?.[0]?.DomainName }));
    if (items.length) networking.push({ serviceName: "CloudFront Distributions", icon: "🌍", count: items.length, resources: items });
  });

  // API Gateway REST APIs
  await safe(async () => {
    const { APIGatewayClient, GetRestApisCommand } = await import("@aws-sdk/client-api-gateway");
    const client = new APIGatewayClient({ region });
    const res = await client.send(new GetRestApisCommand({}));
    const items = (res.items ?? []).map(a => ({ name: a.name ?? "", id: a.id ?? "", details: a.description }));
    if (items.length) networking.push({ serviceName: "API Gateway (REST)", icon: "🔌", count: items.length, resources: items });
  });

  // API Gateway HTTP APIs (v2)
  await safe(async () => {
    const { ApiGatewayV2Client, GetApisCommand } = await import("@aws-sdk/client-apigatewayv2");
    const client = new ApiGatewayV2Client({ region });
    const res = await client.send(new GetApisCommand({}));
    const items = (res.Items ?? []).map(a => ({ name: a.Name ?? "", id: a.ApiId ?? "", status: a.ProtocolType, details: a.ApiEndpoint }));
    if (items.length) networking.push({ serviceName: "API Gateway (HTTP)", icon: "🔗", count: items.length, resources: items });
  });

  // Route 53 Hosted Zones
  await safe(async () => {
    const { Route53Client, ListHostedZonesCommand } = await import("@aws-sdk/client-route-53");
    const client = new Route53Client({ region: "us-east-1" });
    const res = await client.send(new ListHostedZonesCommand({}));
    const items = (res.HostedZones ?? []).map(z => ({ name: z.Name ?? "", id: z.Id ?? "", details: z.Config?.PrivateZone ? "Private" : "Public" }));
    if (items.length) networking.push({ serviceName: "Route 53 Hosted Zones", icon: "🗺️", count: items.length, resources: items });
  });

  if (networking.length) categories.push({ category: "Networking & Content Delivery", icon: "🌐", services: networking });

  // ═══════════════════════════════════════════
  // SECURITY & IDENTITY
  // ═══════════════════════════════════════════
  const security: SvcEntry[] = [];

  // IAM Roles
  await safe(async () => {
    const client = new IAMClient({ region });
    const res = await client.send(new ListRolesCommand({}));
    const items = (res.Roles ?? []).filter(r => !r.Path?.startsWith("/aws-service-role/")).map(r => ({ name: r.RoleName ?? "", id: r.Arn ?? "", details: r.Path, createdAt: r.CreateDate?.toISOString() ?? "" }));
    if (items.length) security.push({ serviceName: "IAM Roles", icon: "🔑", count: items.length, resources: items });
  });

  // IAM Users
  await safe(async () => {
    const client = new IAMClient({ region });
    const res = await client.send(new ListUsersCommand({}));
    const items = (res.Users ?? []).map(u => ({ name: u.UserName ?? "", id: u.Arn ?? "", details: `Created ${u.CreateDate?.toISOString().split("T")[0] ?? ""}`, createdAt: u.CreateDate?.toISOString() ?? "" }));
    if (items.length) security.push({ serviceName: "IAM Users", icon: "👤", count: items.length, resources: items });
  });

  // IAM Groups
  await safe(async () => {
    const client = new IAMClient({ region });
    const res = await client.send(new ListGroupsCommand({}));
    const items = (res.Groups ?? []).map(g => ({ name: g.GroupName ?? "", id: g.Arn ?? "", details: g.Path }));
    if (items.length) security.push({ serviceName: "IAM Groups", icon: "👥", count: items.length, resources: items });
  });

  // IAM Policies (customer-managed only)
  await safe(async () => {
    const client = new IAMClient({ region });
    const res = await client.send(new ListPoliciesCommand({ Scope: "Local" }));
    const items = (res.Policies ?? []).map(p => ({ name: p.PolicyName ?? "", id: p.Arn ?? "", details: `v${p.DefaultVersionId ?? "?"}` }));
    if (items.length) security.push({ serviceName: "IAM Policies (Custom)", icon: "📜", count: items.length, resources: items });
  });

  // Cognito User Pools
  await safe(async () => {
    const { CognitoIdentityProviderClient, ListUserPoolsCommand } = await import("@aws-sdk/client-cognito-identity-provider");
    const client = new CognitoIdentityProviderClient({ region });
    const res = await client.send(new ListUserPoolsCommand({ MaxResults: 60 }));
    const items = (res.UserPools ?? []).map(p => ({ name: p.Name ?? "", id: p.Id ?? "", status: p.Status, details: `Created ${p.CreationDate?.toISOString().split("T")[0] ?? ""}` }));
    if (items.length) security.push({ serviceName: "Cognito User Pools", icon: "🔐", count: items.length, resources: items });
  });

  // Secrets Manager
  await safe(async () => {
    const { SecretsManagerClient, ListSecretsCommand } = await import("@aws-sdk/client-secrets-manager");
    const client = new SecretsManagerClient({ region });
    const res = await client.send(new ListSecretsCommand({}));
    const items = (res.SecretList ?? []).map(s => ({ name: s.Name ?? "", id: s.ARN ?? "", details: `Last rotated: ${s.LastRotatedDate?.toISOString().split("T")[0] ?? "Never"}` }));
    if (items.length) security.push({ serviceName: "Secrets Manager", icon: "🤫", count: items.length, resources: items });
  });

  // ACM Certificates
  await safe(async () => {
    const { ACMClient, ListCertificatesCommand } = await import("@aws-sdk/client-acm");
    const client = new ACMClient({ region });
    const res = await client.send(new ListCertificatesCommand({}));
    const items = (res.CertificateSummaryList ?? []).map(c => ({ name: c.DomainName ?? "", id: c.CertificateArn ?? "", status: c.Status }));
    if (items.length) security.push({ serviceName: "ACM Certificates", icon: "🔒", count: items.length, resources: items });
  });

  // KMS Keys
  await safe(async () => {
    const { KMSClient, ListKeysCommand, DescribeKeyCommand } = await import("@aws-sdk/client-kms");
    const client = new KMSClient({ region });
    const res = await client.send(new ListKeysCommand({}));
    const items: ServiceResource[] = [];
    for (const k of (res.Keys ?? []).slice(0, 20)) {
      const desc = await safe(async () => { const d = await client.send(new DescribeKeyCommand({ KeyId: k.KeyId })); return d.KeyMetadata; });
      if (desc && desc.KeyManager === "CUSTOMER") items.push({ name: desc.Description || (k.KeyId ?? ""), id: k.KeyArn ?? "", status: desc.KeyState, details: desc.KeyUsage });
    }
    if (items.length) security.push({ serviceName: "KMS Keys (Custom)", icon: "🗝️", count: items.length, resources: items });
  });

  // WAF Web ACLs
  await safe(async () => {
    const { WAFV2Client, ListWebACLsCommand } = await import("@aws-sdk/client-wafv2");
    const client = new WAFV2Client({ region });
    const res = await client.send(new ListWebACLsCommand({ Scope: "REGIONAL" }));
    const items = (res.WebACLs ?? []).map(w => ({ name: w.Name ?? "", id: w.ARN ?? "", details: w.Description }));
    if (items.length) security.push({ serviceName: "WAF Web ACLs", icon: "🧱", count: items.length, resources: items });
  });

  if (security.length) categories.push({ category: "Security & Identity", icon: "🔐", services: security });

  // ═══════════════════════════════════════════
  // APPLICATION INTEGRATION
  // ═══════════════════════════════════════════
  const appIntegration: SvcEntry[] = [];

  // Step Functions
  await safe(async () => {
    const client = new SFNClient({ region });
    const res = await client.send(new ListStateMachinesCommand({}));
    const items = (res.stateMachines ?? []).map(m => ({ name: m.name ?? "", id: m.stateMachineArn ?? "", status: "Active" }));
    if (items.length) appIntegration.push({ serviceName: "Step Functions", icon: "🔄", count: items.length, resources: items });
  });

  // SNS Topics
  await safe(async () => {
    const client = new SNSClient({ region });
    const res = await client.send(new ListTopicsCommand({}));
    const items = (res.Topics ?? []).map((t: any) => ({ name: t.TopicArn?.split(":").pop() ?? "", id: t.TopicArn ?? "", status: "Active" }));
    if (items.length) appIntegration.push({ serviceName: "SNS Topics", icon: "📢", count: items.length, resources: items });
  });

  // SNS Subscriptions
  await safe(async () => {
    const client = new SNSClient({ region });
    const res = await client.send(new ListSubscriptionsCommand({}));
    const items = (res.Subscriptions ?? []).map((s: any) => ({ name: s.Endpoint ?? "", id: s.SubscriptionArn ?? "", details: `${s.Protocol} → ${s.TopicArn?.split(":").pop() ?? ""}` }));
    if (items.length) appIntegration.push({ serviceName: "SNS Subscriptions", icon: "📩", count: items.length, resources: items });
  });

  // SQS Queues
  await safe(async () => {
    const client = new SQSClient({ region });
    const res = await client.send(new ListQueuesCommand({}));
    const items = (res.QueueUrls ?? []).map((url: string) => ({ name: url.split("/").pop() ?? "", id: url, status: "Active" }));
    if (items.length) appIntegration.push({ serviceName: "SQS Queues", icon: "📬", count: items.length, resources: items });
  });

  // EventBridge Rules
  await safe(async () => {
    const { EventBridgeClient, ListRulesCommand } = await import("@aws-sdk/client-eventbridge");
    const client = new EventBridgeClient({ region });
    const res = await client.send(new ListRulesCommand({}));
    const items = (res.Rules ?? []).map(r => ({ name: r.Name ?? "", id: r.Arn ?? "", status: r.State, details: r.ScheduleExpression ?? r.Description }));
    if (items.length) appIntegration.push({ serviceName: "EventBridge Rules", icon: "📅", count: items.length, resources: items });
  });

  // Kinesis Streams
  await safe(async () => {
    const { KinesisClient, ListStreamsCommand } = await import("@aws-sdk/client-kinesis");
    const client = new KinesisClient({ region });
    const res = await client.send(new ListStreamsCommand({}));
    const items = (res.StreamNames ?? []).map(n => ({ name: n, id: n, status: "Active" }));
    if (items.length) appIntegration.push({ serviceName: "Kinesis Streams", icon: "🌊", count: items.length, resources: items });
  });

  if (appIntegration.length) categories.push({ category: "Application Integration", icon: "🔗", services: appIntegration });

  // ═══════════════════════════════════════════
  // DEVELOPER TOOLS & CI/CD
  // ═══════════════════════════════════════════
  const devtools: SvcEntry[] = [];

  // Amplify Apps
  await safe(async () => {
    const { AmplifyClient, ListAppsCommand } = await import("@aws-sdk/client-amplify");
    const client = new AmplifyClient({ region });
    const res = await client.send(new ListAppsCommand({}));
    const items = (res.apps ?? []).map(a => ({ name: a.name ?? "", id: a.appId ?? "", status: a.defaultDomain ? "Active" : "Inactive", details: a.repository ?? a.defaultDomain }));
    if (items.length) devtools.push({ serviceName: "Amplify Apps", icon: "📱", count: items.length, resources: items });
  });

  // CodePipeline
  await safe(async () => {
    const { CodePipelineClient, ListPipelinesCommand } = await import("@aws-sdk/client-codepipeline");
    const client = new CodePipelineClient({ region });
    const res = await client.send(new ListPipelinesCommand({}));
    const items = (res.pipelines ?? []).map(p => ({ name: p.name ?? "", id: p.name ?? "", details: `Updated ${p.updated?.toISOString().split("T")[0] ?? ""}` }));
    if (items.length) devtools.push({ serviceName: "CodePipeline", icon: "🔧", count: items.length, resources: items });
  });

  // CodeBuild Projects
  await safe(async () => {
    const { CodeBuildClient, ListProjectsCommand } = await import("@aws-sdk/client-codebuild");
    const client = new CodeBuildClient({ region });
    const res = await client.send(new ListProjectsCommand({}));
    const items = (res.projects ?? []).map(p => ({ name: p, id: p, status: "Active" }));
    if (items.length) devtools.push({ serviceName: "CodeBuild Projects", icon: "🏗️", count: items.length, resources: items });
  });

  // CodeCommit Repos
  await safe(async () => {
    const { CodeCommitClient, ListRepositoriesCommand } = await import("@aws-sdk/client-codecommit");
    const client = new CodeCommitClient({ region });
    const res = await client.send(new ListRepositoriesCommand({}));
    const items = (res.repositories ?? []).map(r => ({ name: r.repositoryName ?? "", id: r.repositoryId ?? "" }));
    if (items.length) devtools.push({ serviceName: "CodeCommit Repos", icon: "📂", count: items.length, resources: items });
  });

  if (devtools.length) categories.push({ category: "Developer Tools & CI/CD", icon: "🛠️", services: devtools });

  // ═══════════════════════════════════════════
  // MANAGEMENT & MONITORING
  // ═══════════════════════════════════════════
  const management: SvcEntry[] = [];

  // CloudWatch Log Groups
  await safe(async () => {
    const client = new CloudWatchLogsClient({ region });
    const res = await client.send(new DescribeLogGroupsCommand({ limit: 50 }));
    const items = (res.logGroups ?? []).map(g => ({ name: g.logGroupName ?? "", id: g.arn ?? "", details: g.storedBytes ? `${(g.storedBytes / 1024 / 1024).toFixed(1)}MB` : undefined }));
    if (items.length) management.push({ serviceName: "CloudWatch Log Groups", icon: "📝", count: items.length, resources: items });
  });

  // CloudWatch Alarms
  await safe(async () => {
    const { CloudWatchClient, DescribeAlarmsCommand } = await import("@aws-sdk/client-cloudwatch");
    const client = new CloudWatchClient({ region });
    const res = await client.send(new DescribeAlarmsCommand({}));
    const items = (res.MetricAlarms ?? []).map(a => ({ name: a.AlarmName ?? "", id: a.AlarmArn ?? "", status: a.StateValue, details: `${a.MetricName} ${a.ComparisonOperator} ${a.Threshold}` }));
    if (items.length) management.push({ serviceName: "CloudWatch Alarms", icon: "🚨", count: items.length, resources: items });
  });

  // CloudFormation Stacks
  await safe(async () => {
    const client = new CloudFormationClient({ region });
    const res = await client.send(new ListStacksCommand({ StackStatusFilter: ["CREATE_COMPLETE", "UPDATE_COMPLETE", "UPDATE_ROLLBACK_COMPLETE"] }));
    const items = (res.StackSummaries ?? []).map((s: any) => ({ name: s.StackName ?? "", id: s.StackId ?? "", status: s.StackStatus, details: `Updated ${s.LastUpdatedTime?.toISOString().split("T")[0] ?? s.CreationTime?.toISOString().split("T")[0] ?? ""}` }));
    if (items.length) management.push({ serviceName: "CloudFormation Stacks", icon: "📚", count: items.length, resources: items });
  });

  // SSM Parameters
  await safe(async () => {
    const { SSMClient, DescribeParametersCommand } = await import("@aws-sdk/client-ssm");
    const client = new SSMClient({ region });
    const res = await client.send(new DescribeParametersCommand({ MaxResults: 50 }));
    const items = (res.Parameters ?? []).map(p => ({ name: p.Name ?? "", id: p.Name ?? "", details: `${p.Type} · v${p.Version ?? "?"}` }));
    if (items.length) management.push({ serviceName: "SSM Parameters", icon: "⚙️", count: items.length, resources: items });
  });

  // CloudTrail Trails
  await safe(async () => {
    const { CloudTrailClient, DescribeTrailsCommand } = await import("@aws-sdk/client-cloudtrail");
    const client = new CloudTrailClient({ region });
    const res = await client.send(new DescribeTrailsCommand({}));
    const items = (res.trailList ?? []).map(t => ({ name: t.Name ?? "", id: t.TrailARN ?? "", details: `S3: ${t.S3BucketName}` }));
    if (items.length) management.push({ serviceName: "CloudTrail Trails", icon: "🔍", count: items.length, resources: items });
  });

  if (management.length) categories.push({ category: "Management & Monitoring", icon: "📊", services: management });

  // ═══════════════════════════════════════════
  // ANALYTICS & ML
  // ═══════════════════════════════════════════
  const analytics: SvcEntry[] = [];

  // Glue Databases
  await safe(async () => {
    const { GlueClient, GetDatabasesCommand } = await import("@aws-sdk/client-glue");
    const client = new GlueClient({ region });
    const res = await client.send(new GetDatabasesCommand({}));
    const items = (res.DatabaseList ?? []).map(d => ({ name: d.Name ?? "", id: d.Name ?? "", details: d.Description }));
    if (items.length) analytics.push({ serviceName: "Glue Databases", icon: "🧪", count: items.length, resources: items });
  });

  // Athena Work Groups
  await safe(async () => {
    const { AthenaClient, ListWorkGroupsCommand } = await import("@aws-sdk/client-athena");
    const client = new AthenaClient({ region });
    const res = await client.send(new ListWorkGroupsCommand({}));
    const items = (res.WorkGroups ?? []).map(w => ({ name: w.Name ?? "", id: w.Name ?? "", status: w.State, details: w.Description }));
    if (items.length) analytics.push({ serviceName: "Athena Work Groups", icon: "🔎", count: items.length, resources: items });
  });

  // SageMaker Notebooks
  await safe(async () => {
    const { SageMakerClient, ListNotebookInstancesCommand } = await import("@aws-sdk/client-sagemaker");
    const client = new SageMakerClient({ region });
    const res = await client.send(new ListNotebookInstancesCommand({}));
    const items = (res.NotebookInstances ?? []).map(n => ({ name: n.NotebookInstanceName ?? "", id: n.NotebookInstanceArn ?? "", status: n.NotebookInstanceStatus, details: n.InstanceType }));
    if (items.length) analytics.push({ serviceName: "SageMaker Notebooks", icon: "🧠", count: items.length, resources: items });
  });

  if (analytics.length) categories.push({ category: "Analytics & ML", icon: "📈", services: analytics });

  // ═══════════════════════════════════════════
  // COST ESTIMATION — based on actual resource attributes
  // Uses us-east-1 on-demand pricing. Prices per hour * 730 hrs/mo.
  // Free-tier eligible resources show $0.00 when within limits.
  // ═══════════════════════════════════════════

  // EC2 on-demand hourly prices (us-east-1, Linux)
  const ec2Hourly: Record<string, number> = {
    "t2.nano": 0.0058, "t2.micro": 0.0116, "t2.small": 0.023, "t2.medium": 0.0464, "t2.large": 0.0928, "t2.xlarge": 0.1856,
    "t3.nano": 0.0052, "t3.micro": 0.0104, "t3.small": 0.0208, "t3.medium": 0.0416, "t3.large": 0.0832, "t3.xlarge": 0.1664,
    "t3a.nano": 0.0047, "t3a.micro": 0.0094, "t3a.small": 0.0188, "t3a.medium": 0.0376, "t3a.large": 0.0752,
    "m5.large": 0.096, "m5.xlarge": 0.192, "m5.2xlarge": 0.384, "m6i.large": 0.096, "m6i.xlarge": 0.192,
    "c5.large": 0.085, "c5.xlarge": 0.17, "c6i.large": 0.085, "r5.large": 0.126, "r5.xlarge": 0.252,
  };

  // EBS per-GB/month prices by volume type
  const ebsPerGB: Record<string, number> = {
    "gp2": 0.10, "gp3": 0.08, "io1": 0.125, "io2": 0.125, "st1": 0.045, "sc1": 0.015, "standard": 0.05,
  };

  // RDS on-demand hourly (single-AZ, us-east-1)
  const rdsHourly: Record<string, number> = {
    "db.t2.micro": 0.017, "db.t3.micro": 0.017, "db.t3.small": 0.034, "db.t3.medium": 0.068, "db.t3.large": 0.136,
    "db.t4g.micro": 0.016, "db.t4g.small": 0.032, "db.t4g.medium": 0.065,
    "db.m5.large": 0.171, "db.m5.xlarge": 0.342, "db.r5.large": 0.24, "db.r5.xlarge": 0.48,
    "db.m6g.large": 0.154, "db.r6g.large": 0.216,
  };

  // ElastiCache hourly (us-east-1)
  const cacheHourly: Record<string, number> = {
    "cache.t2.micro": 0.017, "cache.t3.micro": 0.017, "cache.t3.small": 0.034, "cache.t3.medium": 0.068,
    "cache.m5.large": 0.156, "cache.r5.large": 0.218,
  };

  const costMap: Record<string, (r: ServiceResource) => number> = {
    "EC2 Instances": (r) => {
      if (r.status === "stopped" || r.status === "terminated") return 0;
      try {
        const d = JSON.parse(r.details ?? "{}");
        const instanceType = d.instanceType ?? "";
        const hourly = ec2Hourly[instanceType];
        if (!hourly) return 0; // unknown type — don't guess
        // Calculate actual running hours from LaunchTime
        if (d.launchTime) {
          const launchMs = new Date(d.launchTime).getTime();
          const nowMs = Date.now();
          const runningHours = Math.max(0, (nowMs - launchMs) / (1000 * 60 * 60));
          const cost = hourly * runningHours;
          // Rewrite details as human-readable with cost breakdown
          r.details = `${instanceType} · ${d.platform ?? "Linux"} · Running ${formatDuration(runningHours)} · $${hourly}/hr`;
          return cost;
        }
        r.details = `${instanceType} · ${d.platform ?? "Linux"} · $${hourly}/hr`;
        return hourly * 730; // fallback to full month if no launch time
      } catch {
        return 0;
      }
    },
    "Lambda Functions": () => 0,
    "Lambda Layers": () => 0,
    "S3 Buckets": () => 0,
    "EBS Volumes": (r) => {
      try {
        const d = JSON.parse(r.details ?? "{}");
        const gb = d.sizeGB ?? 0;
        const volType = (d.volumeType ?? "gp3").toLowerCase();
        const pricePerGB = ebsPerGB[volType] ?? 0.08;
        const cost = gb * pricePerGB;
        r.details = `${gb}GB ${volType.toUpperCase()} · $${pricePerGB}/GB-mo`;
        if (d.iops && (volType === "io1" || volType === "io2")) {
          r.details += ` · ${d.iops} IOPS`;
        }
        return cost;
      } catch {
        return 0;
      }
    },
    "EFS File Systems": (r) => {
      const match = r.details?.match(/([\d.]+)\s*MB/i);
      if (!match) return 0;
      const mb = parseFloat(match[1]);
      const gb = mb / 1024;
      const cost = gb * 0.30;
      r.details = `${mb.toFixed(1)}MB · $0.30/GB-mo`;
      return cost;
    },
    "ECR Repositories": () => 0,
    "DynamoDB Tables": () => 0,
    "RDS Instances": (r) => {
      try {
        const d = JSON.parse(r.details ?? "{}");
        const instanceClass = d.instanceClass ?? "";
        if (r.status === "stopped") {
          // Stopped RDS: storage still charged
          const storageCost = (d.storageGB ?? 20) * 0.115;
          r.details = `${d.engine ?? ""} · ${instanceClass} · Stopped · Storage: ${d.storageGB ?? 20}GB ${d.storageType ?? "gp2"} ($${storageCost.toFixed(2)}/mo)`;
          return storageCost;
        }
        const hourly = rdsHourly[instanceClass];
        const computeCost = hourly ? hourly * 730 : 0;
        const storageCost = (d.storageGB ?? 20) * 0.115;
        const totalCost = computeCost + storageCost;
        const parts = [`${d.engine ?? ""}`, instanceClass];
        if (d.multiAZ) parts.push("Multi-AZ");
        parts.push(`${d.storageGB ?? 20}GB ${d.storageType ?? "gp2"}`);
        if (hourly) parts.push(`$${hourly}/hr compute + $${storageCost.toFixed(2)}/mo storage`);
        r.details = parts.join(" · ");
        return totalCost;
      } catch {
        return 0;
      }
    },
    "Aurora Clusters": (r) => {
      if (r.status === "stopped") return 0;
      return 0;
    },
    "ElastiCache Clusters": (r) => {
      const parts = (r.details ?? "").split("·").map(s => s.trim());
      const nodeType = parts[1] ?? parts[0] ?? "";
      const hourly = cacheHourly[nodeType];
      if (hourly) {
        r.details = `${parts[0] ?? ""} · ${nodeType} · $${hourly}/hr`;
        return hourly * 730;
      }
      return 0;
    },
    "VPCs": () => 0,
    "Subnets": () => 0,
    "Internet Gateways": () => 0,
    "Security Groups": () => 0,
    "Load Balancers": (r) => {
      const lbType = (r.details ?? "").toLowerCase();
      const hourly = 0.0225;
      r.details = `${r.details ?? "ALB"} · $${hourly}/hr ($${(hourly * 730).toFixed(2)}/mo)`;
      return hourly * 730;
    },
    "Target Groups": () => 0,
    "Elastic IPs": (r) => {
      if (r.status === "Associated") { r.details = `${r.details ?? ""} · Free (associated)`; return 0; }
      r.details = `${r.details ?? "No instance"} · $0.005/hr idle ($3.65/mo)`;
      return 0.005 * 730;
    },
    "NAT Gateways": (r) => {
      r.details = `$0.045/hr ($32.85/mo) + data processing`;
      return 0.045 * 730;
    },
    "CloudFront Distributions": () => 0,
    "API Gateway (REST)": () => 0,
    "API Gateway (HTTP)": () => 0,
    "Route 53 Hosted Zones": (r) => { r.details = `${r.details ?? ""} · $0.50/zone/mo`; return 0.50; },
    "IAM Roles": () => 0, "IAM Users": () => 0, "IAM Groups": () => 0, "IAM Policies (Custom)": () => 0,
    "Cognito User Pools": () => 0,
    "Secrets Manager": (r) => { r.details = `${r.details ?? ""} · $0.40/secret/mo`; return 0.40; },
    "ACM Certificates": () => 0,
    "KMS Keys (Custom)": (r) => { r.details = `${r.details ?? ""} · $1.00/key/mo`; return 1.00; },
    "WAF Web ACLs": (r) => { r.details = `${r.details ?? ""} · $5.00/ACL/mo + $1/rule`; return 5.00; },
    "Step Functions": () => 0,
    "SNS Topics": () => 0,
    "SNS Subscriptions": () => 0,
    "SQS Queues": () => 0,
    "EventBridge Rules": () => 0,
    "Kinesis Streams": (r) => { r.details = `$0.015/shard-hr ($10.95/shard/mo)`; return 0.015 * 730; },
    "Amplify Apps": () => 0,
    "CodePipeline": (r) => { r.details = `${r.details ?? ""} · $1.00/pipeline/mo`; return 1.00; },
    "CodeBuild Projects": () => 0,
    "CodeCommit Repos": () => 0,
    "CloudWatch Log Groups": (r) => {
      const match = r.details?.match(/([\d.]+)\s*MB/i);
      if (!match) return 0;
      const mb = parseFloat(match[1]);
      const gb = mb / 1024;
      const cost = gb * 0.03;
      r.details = `${mb.toFixed(1)}MB stored · $0.03/GB-mo ($${cost.toFixed(2)}/mo)`;
      return cost;
    },
    "CloudWatch Alarms": (r) => { r.details = `${r.details ?? ""} · $0.10/alarm/mo`; return 0.10; },
    "CloudFormation Stacks": () => 0,
    "SSM Parameters": () => 0,
    "CloudTrail Trails": () => 0,
    "Glue Databases": () => 0,
    "Athena Work Groups": () => 0,
    "SageMaker Notebooks": (r) => {
      const instanceType = (r.details ?? "").trim();
      if (r.status === "Stopped") return 0;
      const prices: Record<string, number> = { "ml.t2.medium": 0.0464, "ml.t3.medium": 0.0416, "ml.m5.xlarge": 0.23 };
      const hourly = prices[instanceType];
      if (hourly) { r.details = `${instanceType} · $${hourly}/hr ($${(hourly * 730).toFixed(2)}/mo)`; return hourly * 730; }
      return 0;
    },
  };

  // Helper to format running duration
  function formatDuration(hours: number): string {
    if (hours < 1) return `${Math.round(hours * 60)}min`;
    if (hours < 24) return `${hours.toFixed(1)}hrs`;
    const days = Math.floor(hours / 24);
    const remainHrs = Math.round(hours % 24);
    return `${days}d ${remainHrs}h`;
  }

  for (const cat of categories) {
    let catCost = 0;
    for (const svc of cat.services) {
      const estimator = costMap[svc.serviceName];
      let svcCost = 0;
      if (estimator) {
        for (const r of svc.resources) {
          const cost = estimator(r);
          r.estimatedMonthlyCost = Math.round(cost * 100) / 100;
          svcCost += cost;
        }
      }
      svc.estimatedMonthlyCost = Math.round(svcCost * 100) / 100;
      catCost += svcCost;
    }
    cat.estimatedMonthlyCost = Math.round(catCost * 100) / 100;
  }

  // ═══════════════════════════════════════════
  // STALE RESOURCE DETECTION — flag resources inactive for 6+ months
  // ═══════════════════════════════════════════
  const SIX_MONTHS_MS = 180 * 24 * 60 * 60 * 1000;
  const now = Date.now();

  for (const cat of categories) {
    for (const svc of cat.services) {
      for (const r of svc.resources) {
        if (r.createdAt) {
          const createdMs = new Date(r.createdAt).getTime();
          if (!isNaN(createdMs)) {
            const ageMs = now - createdMs;
            if (ageMs > SIX_MONTHS_MS) {
              r.stale = true;
              r.staleDays = Math.floor(ageMs / (24 * 60 * 60 * 1000));
            }
          }
        }
      }
    }
  }

  return categories;
}
