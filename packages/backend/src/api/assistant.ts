import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { EC2Client, DescribeInstancesCommand, DescribeVolumesCommand, DescribeSecurityGroupsCommand, DescribeAddressesCommand, StopInstancesCommand, StartInstancesCommand, TerminateInstancesCommand, RunInstancesCommand, CreateVolumeCommand, DeleteVolumeCommand, DescribeSubnetsCommand, DescribeVpcsCommand, AllocateAddressCommand, ReleaseAddressCommand, AssociateAddressCommand, DisassociateAddressCommand, CreateSecurityGroupCommand, DeleteSecurityGroupCommand, AuthorizeSecurityGroupIngressCommand, RevokeSecurityGroupIngressCommand, CreateTagsCommand, DescribeSnapshotsCommand, CreateSnapshotCommand, DescribeImagesCommand, RebootInstancesCommand, DescribeKeyPairsCommand } from "@aws-sdk/client-ec2";
import { S3Client, ListBucketsCommand, CreateBucketCommand, DeleteBucketCommand, GetPublicAccessBlockCommand, PutPublicAccessBlockCommand, GetBucketAclCommand, PutObjectCommand, ListObjectsV2Command, DeleteObjectCommand, PutBucketPolicyCommand, DeleteBucketPolicyCommand, GetBucketVersioningCommand, PutBucketVersioningCommand } from "@aws-sdk/client-s3";
import { LambdaClient, ListFunctionsCommand, GetFunctionCommand, DeleteFunctionCommand, InvokeCommand as LambdaInvokeCommand, UpdateFunctionConfigurationCommand } from "@aws-sdk/client-lambda";
import { IAMClient, ListRolesCommand, ListUsersCommand, ListPoliciesCommand, ListAttachedRolePoliciesCommand, ListAttachedUserPoliciesCommand, CreateUserCommand, DeleteUserCommand, CreateRoleCommand, DeleteRoleCommand, AttachRolePolicyCommand, DetachRolePolicyCommand, AttachUserPolicyCommand, DetachUserPolicyCommand, ListAccessKeysCommand, CreateAccessKeyCommand, DeleteAccessKeyCommand, GetUserCommand } from "@aws-sdk/client-iam";
import { RDSClient, DescribeDBInstancesCommand, StopDBInstanceCommand, StartDBInstanceCommand, DescribeDBSnapshotsCommand, CreateDBSnapshotCommand } from "@aws-sdk/client-rds";
import { DynamoDBClient, ListTablesCommand, DescribeTableCommand, DeleteTableCommand, CreateTableCommand, ScanCommand } from "@aws-sdk/client-dynamodb";
import { CloudWatchLogsClient, DescribeLogGroupsCommand, DeleteLogGroupCommand, CreateLogGroupCommand, GetLogEventsCommand, DescribeLogStreamsCommand } from "@aws-sdk/client-cloudwatch-logs";
import { SNSClient, ListTopicsCommand, CreateTopicCommand, DeleteTopicCommand, ListSubscriptionsCommand, SubscribeCommand, PublishCommand } from "@aws-sdk/client-sns";
import { SQSClient, ListQueuesCommand, CreateQueueCommand, DeleteQueueCommand, GetQueueAttributesCommand, SendMessageCommand } from "@aws-sdk/client-sqs";
import { CloudFormationClient, ListStacksCommand, DescribeStacksCommand, DeleteStackCommand } from "@aws-sdk/client-cloudformation";
import { CloudWatchClient, ListMetricsCommand, GetMetricStatisticsCommand, DescribeAlarmsCommand, PutMetricAlarmCommand, DeleteAlarmsCommand } from "@aws-sdk/client-cloudwatch";
import { Route53Client, ListHostedZonesCommand, ListResourceRecordSetsCommand } from "@aws-sdk/client-route-53";
import { ECSClient, ListClustersCommand, ListServicesCommand, ListTasksCommand, DescribeClustersCommand } from "@aws-sdk/client-ecs";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { CostExplorerClient, GetCostAndUsageCommand } from "@aws-sdk/client-cost-explorer";
import { GovernanceDataRepository } from "../repository";

const bedrock = new BedrockRuntimeClient({ region: "us-east-1" });
const ec2 = new EC2Client({ region: "us-east-1" });
const s3 = new S3Client({ region: "us-east-1" });
const lambdaClient = new LambdaClient({ region: "us-east-1" });
const iam = new IAMClient({ region: "us-east-1" });
const rds = new RDSClient({ region: "us-east-1" });
const ddb = new DynamoDBClient({ region: "us-east-1" });
const logs = new CloudWatchLogsClient({ region: "us-east-1" });
const sns = new SNSClient({ region: "us-east-1" });
const sqs = new SQSClient({ region: "us-east-1" });
const cfn = new CloudFormationClient({ region: "us-east-1" });
const cw = new CloudWatchClient({ region: "us-east-1" });
const route53 = new Route53Client({ region: "us-east-1" });
const ecs = new ECSClient({ region: "us-east-1" });
const sts = new STSClient({ region: "us-east-1" });
const costExplorer = new CostExplorerClient({ region: "us-east-1" });
const repo = new GovernanceDataRepository();

interface Attachment { type: "image" | "video" | "document"; format: string; data: string; name?: string; }
interface Message { role: "user" | "assistant"; content: string; }
interface AssistantRequest { message: string; history?: Message[]; attachments?: Attachment[]; }
interface AssistantResponse { reply: string; action?: string; actionResult?: string; }

const TOOLS = [
  // EC2
  { name: "list_ec2_instances", description: "List all EC2 instances with their state, type, and IDs" },
  { name: "create_ec2_instance", description: "Launch a new EC2 instance. Requires: instanceType (e.g. t2.micro), imageId (AMI ID). Optional: name, keyName, securityGroupId, subnetId" },
  { name: "stop_ec2_instance", description: "Stop an EC2 instance. Requires: instanceId" },
  { name: "start_ec2_instance", description: "Start a stopped EC2 instance. Requires: instanceId" },
  { name: "reboot_ec2_instance", description: "Reboot an EC2 instance. Requires: instanceId" },
  { name: "terminate_ec2_instance", description: "Terminate an EC2 instance. Requires: instanceId" },
  { name: "tag_resource", description: "Add tags to an EC2 resource. Requires: resourceId, key, value" },
  { name: "list_key_pairs", description: "List EC2 key pairs" },
  { name: "list_amis", description: "List recent Amazon Linux and Ubuntu AMIs for launching instances" },
  // EBS
  { name: "list_ebs_volumes", description: "List EBS volumes with state and size" },
  { name: "create_ebs_volume", description: "Create a new EBS volume. Requires: size (GB), availabilityZone. Optional: volumeType, name" },
  { name: "delete_ebs_volume", description: "Delete an EBS volume. Requires: volumeId" },
  { name: "list_snapshots", description: "List EBS snapshots owned by this account" },
  { name: "create_snapshot", description: "Create an EBS snapshot. Requires: volumeId. Optional: description" },
  // VPC / Networking
  { name: "list_vpcs", description: "List all VPCs" },
  { name: "list_subnets", description: "List all subnets" },
  { name: "list_security_groups", description: "List security groups" },
  { name: "create_security_group", description: "Create a security group. Requires: groupName, description. Optional: vpcId" },
  { name: "delete_security_group", description: "Delete a security group. Requires: groupId" },
  { name: "add_security_group_rule", description: "Add an inbound rule to a security group. Requires: groupId, protocol (tcp/udp/icmp/-1), fromPort, toPort, cidr (e.g. 0.0.0.0/0)" },
  { name: "remove_security_group_rule", description: "Remove an inbound rule. Requires: groupId, protocol, fromPort, toPort, cidr" },
  { name: "list_elastic_ips", description: "List Elastic IP addresses" },
  { name: "allocate_elastic_ip", description: "Allocate a new Elastic IP" },
  { name: "release_elastic_ip", description: "Release an Elastic IP. Requires: allocationId" },
  { name: "associate_elastic_ip", description: "Associate an Elastic IP with an instance. Requires: allocationId, instanceId" },
  // S3
  { name: "list_s3_buckets", description: "List all S3 buckets" },
  { name: "create_s3_bucket", description: "Create a new S3 bucket. Requires: bucketName" },
  { name: "delete_s3_bucket", description: "Delete an empty S3 bucket. Requires: bucketName" },
  { name: "list_s3_objects", description: "List objects in an S3 bucket. Requires: bucketName. Optional: prefix" },
  { name: "upload_to_s3", description: "Upload attached file(s) to S3. Requires: bucketName. Optional: prefix" },
  { name: "delete_s3_object", description: "Delete an object from S3. Requires: bucketName, key" },
  { name: "check_bucket_public_access", description: "Check if an S3 bucket is public or private. Requires: bucketName" },
  { name: "set_bucket_public_access", description: "Block or allow public access on a bucket. Requires: bucketName, blockAll (true/false)" },
  { name: "set_bucket_policy", description: "Set or delete a bucket policy. Requires: bucketName. Optional: policy (JSON)" },
  { name: "set_bucket_versioning", description: "Enable or suspend versioning. Requires: bucketName, enabled (true/false)" },
  // Lambda
  { name: "list_lambda_functions", description: "List all Lambda functions" },
  { name: "get_lambda_function", description: "Get details of a Lambda function. Requires: functionName" },
  { name: "delete_lambda_function", description: "Delete a Lambda function. Requires: functionName" },
  { name: "invoke_lambda", description: "Invoke a Lambda function. Requires: functionName. Optional: payload (JSON string)" },
  { name: "update_lambda_config", description: "Update Lambda config. Requires: functionName. Optional: timeout, memorySize, description" },
  // IAM
  { name: "list_iam_roles", description: "List IAM roles" },
  { name: "list_iam_users", description: "List IAM users" },
  { name: "list_iam_policies", description: "List IAM policies (customer managed)" },
  { name: "get_iam_user", description: "Get details of an IAM user. Requires: userName" },
  { name: "create_iam_user", description: "Create an IAM user. Requires: userName" },
  { name: "delete_iam_user", description: "Delete an IAM user. Requires: userName" },
  { name: "create_iam_role", description: "Create an IAM role. Requires: roleName, assumeRolePolicy (JSON)" },
  { name: "delete_iam_role", description: "Delete an IAM role. Requires: roleName" },
  { name: "attach_role_policy", description: "Attach a policy to a role. Requires: roleName, policyArn" },
  { name: "detach_role_policy", description: "Detach a policy from a role. Requires: roleName, policyArn" },
  { name: "attach_user_policy", description: "Attach a policy to a user. Requires: userName, policyArn" },
  { name: "detach_user_policy", description: "Detach a policy from a user. Requires: userName, policyArn" },
  { name: "list_role_policies", description: "List policies attached to a role. Requires: roleName" },
  { name: "list_user_policies", description: "List policies attached to a user. Requires: userName" },
  { name: "list_access_keys", description: "List access keys for a user. Requires: userName" },
  { name: "create_access_key", description: "Create an access key for a user. Requires: userName" },
  { name: "delete_access_key", description: "Delete an access key. Requires: userName, accessKeyId" },
  // RDS
  { name: "list_rds_instances", description: "List RDS database instances" },
  { name: "stop_rds_instance", description: "Stop an RDS instance. Requires: dbInstanceId" },
  { name: "start_rds_instance", description: "Start an RDS instance. Requires: dbInstanceId" },
  { name: "list_rds_snapshots", description: "List RDS snapshots" },
  { name: "create_rds_snapshot", description: "Create an RDS snapshot. Requires: dbInstanceId, snapshotId" },
  // DynamoDB
  { name: "list_dynamodb_tables", description: "List DynamoDB tables with details" },
  { name: "describe_dynamodb_table", description: "Describe a DynamoDB table. Requires: tableName" },
  { name: "delete_dynamodb_table", description: "Delete a DynamoDB table. Requires: tableName" },
  { name: "create_dynamodb_table", description: "Create a DynamoDB table. Requires: tableName, partitionKey, partitionKeyType (S/N/B). Optional: sortKey, sortKeyType" },
  { name: "scan_dynamodb_table", description: "Scan/read items from a DynamoDB table. Requires: tableName. Optional: limit (default 10)" },
  // CloudWatch Logs
  { name: "list_log_groups", description: "List CloudWatch Log Groups" },
  { name: "create_log_group", description: "Create a CloudWatch Log Group. Requires: logGroupName" },
  { name: "delete_log_group", description: "Delete a CloudWatch Log Group. Requires: logGroupName" },
  { name: "get_log_events", description: "Get recent log events. Requires: logGroupName, logStreamName. Optional: limit" },
  { name: "list_log_streams", description: "List log streams in a log group. Requires: logGroupName" },
  // SNS
  { name: "list_sns_topics", description: "List SNS topics" },
  { name: "create_sns_topic", description: "Create an SNS topic. Requires: topicName" },
  { name: "delete_sns_topic", description: "Delete an SNS topic. Requires: topicArn" },
  { name: "list_sns_subscriptions", description: "List SNS subscriptions" },
  { name: "subscribe_sns", description: "Subscribe to an SNS topic. Requires: topicArn, protocol (email/sms/lambda/sqs/http/https), endpoint" },
  { name: "publish_sns", description: "Publish a message to an SNS topic. Requires: topicArn, message. Optional: subject" },
  // SQS
  { name: "list_sqs_queues", description: "List SQS queues" },
  { name: "create_sqs_queue", description: "Create an SQS queue. Requires: queueName" },
  { name: "delete_sqs_queue", description: "Delete an SQS queue. Requires: queueUrl" },
  { name: "get_sqs_attributes", description: "Get SQS queue attributes. Requires: queueUrl" },
  { name: "send_sqs_message", description: "Send a message to an SQS queue. Requires: queueUrl, messageBody" },
  // CloudFormation
  { name: "list_cfn_stacks", description: "List CloudFormation stacks" },
  { name: "describe_cfn_stack", description: "Describe a CloudFormation stack. Requires: stackName" },
  { name: "delete_cfn_stack", description: "Delete a CloudFormation stack. Requires: stackName" },
  // CloudWatch Alarms/Metrics
  { name: "list_cw_alarms", description: "List CloudWatch alarms" },
  { name: "create_cw_alarm", description: "Create a CloudWatch alarm. Requires: alarmName, metricName, namespace, threshold, comparisonOperator, period, evaluationPeriods, statistic" },
  { name: "delete_cw_alarm", description: "Delete CloudWatch alarms. Requires: alarmNames (comma-separated)" },
  // Route53
  { name: "list_hosted_zones", description: "List Route53 hosted zones" },
  { name: "list_dns_records", description: "List DNS records in a hosted zone. Requires: hostedZoneId" },
  // ECS
  { name: "list_ecs_clusters", description: "List ECS clusters" },
  { name: "describe_ecs_cluster", description: "Describe an ECS cluster. Requires: clusterArn" },
  // Account / Cost
  { name: "get_account_id", description: "Get the current AWS account ID and caller identity" },
  { name: "get_cost_last_30_days", description: "Get AWS cost breakdown for the last 30 days by service" },
  // CloudGuardian
  { name: "get_scan_summary", description: "Get latest CloudGuardian scan summary" },
  { name: "get_recommendations", description: "Get current recommendations from latest scan" },
];

async function executeTool(name: string, params: Record<string, string>, attachments?: Attachment[]): Promise<string> {
  try {
    switch (name) {
      // === EC2 ===
      case "list_ec2_instances": {
        const res = await ec2.send(new DescribeInstancesCommand({}));
        const instances = (res.Reservations ?? []).flatMap(r => r.Instances ?? []);
        if (instances.length === 0) return "No EC2 instances found.";
        return instances.map(i => {
          const nameTag = i.Tags?.find(t => t.Key === "Name")?.Value ?? "unnamed";
          return `${i.InstanceId} | ${nameTag} | ${i.InstanceType} | ${i.State?.Name} | ${i.PublicIpAddress ?? "no public IP"} | AZ: ${i.Placement?.AvailabilityZone}`;
        }).join("\n");
      }
      case "create_ec2_instance": {
        const instanceType = params.instanceType || "t2.micro";
        const imageId = params.imageId;
        if (!imageId) return "ERROR: imageId (AMI ID) is required. For Amazon Linux 2 in us-east-1, use ami-0c02fb55956c7d316.";
        const runParams: any = { ImageId: imageId, InstanceType: instanceType, MinCount: 1, MaxCount: 1 };
        if (params.keyName) runParams.KeyName = params.keyName;
        if (params.securityGroupId) runParams.SecurityGroupIds = [params.securityGroupId];
        if (params.subnetId) runParams.SubnetId = params.subnetId;
        if (params.name) runParams.TagSpecifications = [{ ResourceType: "instance", Tags: [{ Key: "Name", Value: params.name }] }];
        const res = await ec2.send(new RunInstancesCommand(runParams));
        const inst = res.Instances?.[0];
        return `EC2 instance launched! ID: ${inst?.InstanceId} | Type: ${instanceType} | State: ${inst?.State?.Name}`;
      }
      case "stop_ec2_instance": {
        if (!params.instanceId) return "ERROR: instanceId is required.";
        await ec2.send(new StopInstancesCommand({ InstanceIds: [params.instanceId] }));
        return `EC2 instance ${params.instanceId} is being stopped.`;
      }
      case "start_ec2_instance": {
        if (!params.instanceId) return "ERROR: instanceId is required.";
        await ec2.send(new StartInstancesCommand({ InstanceIds: [params.instanceId] }));
        return `EC2 instance ${params.instanceId} is being started.`;
      }
      case "reboot_ec2_instance": {
        if (!params.instanceId) return "ERROR: instanceId is required.";
        await ec2.send(new RebootInstancesCommand({ InstanceIds: [params.instanceId] }));
        return `EC2 instance ${params.instanceId} is being rebooted.`;
      }
      case "terminate_ec2_instance": {
        if (!params.instanceId) return "ERROR: instanceId is required.";
        await ec2.send(new TerminateInstancesCommand({ InstanceIds: [params.instanceId] }));
        return `EC2 instance ${params.instanceId} is being terminated.`;
      }
      case "tag_resource": {
        if (!params.resourceId || !params.key || !params.value) return "ERROR: resourceId, key, and value are required.";
        await ec2.send(new CreateTagsCommand({ Resources: [params.resourceId], Tags: [{ Key: params.key, Value: params.value }] }));
        return `Tagged ${params.resourceId} with ${params.key}=${params.value}`;
      }
      case "list_key_pairs": {
        const res = await ec2.send(new DescribeKeyPairsCommand({}));
        return (res.KeyPairs ?? []).map(k => `${k.KeyName} | ${k.KeyPairId} | ${k.KeyType}`).join("\n") || "No key pairs found.";
      }
      case "list_amis": {
        const res = await ec2.send(new DescribeImagesCommand({ Owners: ["amazon"], Filters: [{ Name: "name", Values: ["amzn2-ami-hvm-*-x86_64-gp2", "ubuntu/images/hvm-ssd/ubuntu-*-amd64-server-*"] }, { Name: "state", Values: ["available"] }], MaxResults: 10 }));
        return (res.Images ?? []).sort((a, b) => (b.CreationDate ?? "").localeCompare(a.CreationDate ?? "")).slice(0, 10).map(i => `${i.ImageId} | ${i.Name} | ${i.CreationDate?.split("T")[0]}`).join("\n") || "No AMIs found.";
      }
      // === EBS ===
      case "list_ebs_volumes": {
        const res = await ec2.send(new DescribeVolumesCommand({}));
        return (res.Volumes ?? []).map(v => `${v.VolumeId} | ${v.Size}GB | ${v.State} | ${v.VolumeType} | AZ: ${v.AvailabilityZone}`).join("\n") || "No EBS volumes found.";
      }
      case "create_ebs_volume": {
        const size = parseInt(params.size || "0");
        if (!size) return "ERROR: size (in GB) is required.";
        if (!params.availabilityZone) return "ERROR: availabilityZone is required (e.g. us-east-1a).";
        const res = await ec2.send(new CreateVolumeCommand({ Size: size, AvailabilityZone: params.availabilityZone, VolumeType: (params.volumeType || "gp3") as any, TagSpecifications: params.name ? [{ ResourceType: "volume", Tags: [{ Key: "Name", Value: params.name }] }] : undefined }));
        return `EBS volume created! ID: ${res.VolumeId} | ${size}GB | ${params.volumeType || "gp3"} | AZ: ${params.availabilityZone}`;
      }
      case "delete_ebs_volume": {
        if (!params.volumeId) return "ERROR: volumeId is required.";
        await ec2.send(new DeleteVolumeCommand({ VolumeId: params.volumeId }));
        return `EBS volume ${params.volumeId} deleted.`;
      }
      case "list_snapshots": {
        const res = await ec2.send(new DescribeSnapshotsCommand({ OwnerIds: ["self"] }));
        return (res.Snapshots ?? []).slice(0, 30).map(s => `${s.SnapshotId} | ${s.VolumeSize}GB | ${s.State} | ${s.StartTime?.toISOString().split("T")[0]} | ${s.Description ?? ""}`).join("\n") || "No snapshots found.";
      }
      case "create_snapshot": {
        if (!params.volumeId) return "ERROR: volumeId is required.";
        const res = await ec2.send(new CreateSnapshotCommand({ VolumeId: params.volumeId, Description: params.description || `Snapshot of ${params.volumeId}` }));
        return `Snapshot created! ID: ${res.SnapshotId} | Volume: ${params.volumeId} | State: ${res.State}`;
      }
      // === VPC / Networking ===
      case "list_vpcs": {
        const res = await ec2.send(new DescribeVpcsCommand({}));
        return (res.Vpcs ?? []).map(v => { const n = v.Tags?.find(t => t.Key === "Name")?.Value ?? "unnamed"; return `${v.VpcId} | ${n} | ${v.CidrBlock} | Default: ${v.IsDefault}`; }).join("\n") || "No VPCs found.";
      }
      case "list_subnets": {
        const res = await ec2.send(new DescribeSubnetsCommand({}));
        return (res.Subnets ?? []).map(s => { const n = s.Tags?.find(t => t.Key === "Name")?.Value ?? "unnamed"; return `${s.SubnetId} | ${n} | ${s.AvailabilityZone} | ${s.CidrBlock} | VPC: ${s.VpcId}`; }).join("\n") || "No subnets found.";
      }
      case "list_security_groups": {
        const res = await ec2.send(new DescribeSecurityGroupsCommand({}));
        return (res.SecurityGroups ?? []).map(sg => `${sg.GroupId} | ${sg.GroupName} | ${sg.Description} | VPC: ${sg.VpcId}`).join("\n") || "No security groups found.";
      }
      case "create_security_group": {
        if (!params.groupName || !params.description) return "ERROR: groupName and description are required.";
        const res = await ec2.send(new CreateSecurityGroupCommand({ GroupName: params.groupName, Description: params.description, VpcId: params.vpcId || undefined }));
        return `Security group created! ID: ${res.GroupId} | Name: ${params.groupName}`;
      }
      case "delete_security_group": {
        if (!params.groupId) return "ERROR: groupId is required.";
        await ec2.send(new DeleteSecurityGroupCommand({ GroupId: params.groupId }));
        return `Security group ${params.groupId} deleted.`;
      }
      case "add_security_group_rule": {
        if (!params.groupId || !params.protocol || !params.fromPort || !params.toPort || !params.cidr) return "ERROR: groupId, protocol, fromPort, toPort, cidr are required.";
        await ec2.send(new AuthorizeSecurityGroupIngressCommand({ GroupId: params.groupId, IpPermissions: [{ IpProtocol: params.protocol, FromPort: parseInt(params.fromPort), ToPort: parseInt(params.toPort), IpRanges: [{ CidrIp: params.cidr }] }] }));
        return `Added inbound rule: ${params.protocol} ${params.fromPort}-${params.toPort} from ${params.cidr} to ${params.groupId}`;
      }
      case "remove_security_group_rule": {
        if (!params.groupId || !params.protocol || !params.fromPort || !params.toPort || !params.cidr) return "ERROR: groupId, protocol, fromPort, toPort, cidr are required.";
        await ec2.send(new RevokeSecurityGroupIngressCommand({ GroupId: params.groupId, IpPermissions: [{ IpProtocol: params.protocol, FromPort: parseInt(params.fromPort), ToPort: parseInt(params.toPort), IpRanges: [{ CidrIp: params.cidr }] }] }));
        return `Removed inbound rule from ${params.groupId}`;
      }
      case "list_elastic_ips": {
        const res = await ec2.send(new DescribeAddressesCommand({}));
        return (res.Addresses ?? []).map(a => `${a.PublicIp} | ${a.AllocationId} | Associated: ${a.InstanceId ?? "none"}`).join("\n") || "No Elastic IPs found.";
      }
      case "allocate_elastic_ip": {
        const res = await ec2.send(new AllocateAddressCommand({ Domain: "vpc" }));
        return `Elastic IP allocated! IP: ${res.PublicIp} | AllocationId: ${res.AllocationId}`;
      }
      case "release_elastic_ip": {
        if (!params.allocationId) return "ERROR: allocationId is required.";
        await ec2.send(new ReleaseAddressCommand({ AllocationId: params.allocationId }));
        return `Elastic IP ${params.allocationId} released.`;
      }
      case "associate_elastic_ip": {
        if (!params.allocationId || !params.instanceId) return "ERROR: allocationId and instanceId are required.";
        const res = await ec2.send(new AssociateAddressCommand({ AllocationId: params.allocationId, InstanceId: params.instanceId }));
        return `Elastic IP associated! AssociationId: ${res.AssociationId}`;
      }
      // === S3 ===
      case "list_s3_buckets": {
        const res = await s3.send(new ListBucketsCommand({}));
        const buckets = res.Buckets ?? [];
        if (buckets.length === 0) return "No S3 buckets found.";
        return buckets.map(b => `${b.Name} | Created: ${b.CreationDate?.toISOString().split("T")[0]}`).join("\n");
      }
      case "create_s3_bucket": {
        if (!params.bucketName) return "ERROR: bucketName is required.";
        await s3.send(new CreateBucketCommand({ Bucket: params.bucketName }));
        return `S3 bucket "${params.bucketName}" created successfully.`;
      }
      case "delete_s3_bucket": {
        if (!params.bucketName) return "ERROR: bucketName is required.";
        await s3.send(new DeleteBucketCommand({ Bucket: params.bucketName }));
        return `S3 bucket "${params.bucketName}" deleted.`;
      }
      case "list_s3_objects": {
        if (!params.bucketName) return "ERROR: bucketName is required.";
        const res = await s3.send(new ListObjectsV2Command({ Bucket: params.bucketName, Prefix: params.prefix || "", MaxKeys: 50 }));
        const objects = res.Contents ?? [];
        if (objects.length === 0) return `No objects found in s3://${params.bucketName}/${params.prefix || ""}`;
        return objects.map(o => `${o.Key} | ${((o.Size ?? 0) / 1024).toFixed(1)}KB | ${o.LastModified?.toISOString().split("T")[0]}`).join("\n");
      }
      case "upload_to_s3": {
        if (!params.bucketName) return "ERROR: bucketName is required.";
        if (!attachments || attachments.length === 0) return "ERROR: No files attached. Attach files using the paperclip button.";
        const prefix = params.prefix || "";
        const results: string[] = [];
        for (const att of attachments) {
          const fileName = att.name || `file-${Date.now()}.${att.format}`;
          const key = prefix ? `${prefix.replace(/\/$/, "")}/${fileName}` : fileName;
          const body = Buffer.from(att.data, "base64");
          const ctMap: Record<string, string> = { pdf: "application/pdf", txt: "text/plain", csv: "text/csv", html: "text/html", png: "image/png", jpeg: "image/jpeg", jpg: "image/jpeg", gif: "image/gif", webp: "image/webp", mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm", doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", md: "text/markdown" };
          await s3.send(new PutObjectCommand({ Bucket: params.bucketName, Key: key, Body: body, ContentType: ctMap[att.format] || "application/octet-stream" }));
          results.push(`Uploaded: s3://${params.bucketName}/${key} (${(body.length / 1024).toFixed(1)}KB)`);
        }
        return `Successfully uploaded ${results.length} file(s):\n${results.join("\n")}`;
      }
      case "delete_s3_object": {
        if (!params.bucketName || !params.key) return "ERROR: bucketName and key are required.";
        await s3.send(new DeleteObjectCommand({ Bucket: params.bucketName, Key: params.key }));
        return `Deleted s3://${params.bucketName}/${params.key}`;
      }
      case "check_bucket_public_access": {
        if (!params.bucketName) return "ERROR: bucketName is required.";
        const results: string[] = [];
        try {
          const pab = await s3.send(new GetPublicAccessBlockCommand({ Bucket: params.bucketName }));
          const cfg = pab.PublicAccessBlockConfiguration;
          const allBlocked = cfg?.BlockPublicAcls && cfg?.IgnorePublicAcls && cfg?.BlockPublicPolicy && cfg?.RestrictPublicBuckets;
          results.push(`Public Access Block: ${allBlocked ? "ALL BLOCKED (private)" : "SOME PUBLIC ACCESS ALLOWED"}`);
        } catch (e: any) { results.push(e.name === "NoSuchPublicAccessBlockConfiguration" ? "Public Access Block: NOT CONFIGURED" : `Error: ${e.message}`); }
        try {
          const acl = await s3.send(new GetBucketAclCommand({ Bucket: params.bucketName }));
          const pub = (acl.Grants ?? []).filter(g => g.Grantee?.URI?.includes("AllUsers") || g.Grantee?.URI?.includes("AuthenticatedUsers"));
          results.push(pub.length > 0 ? `ACL: ${pub.length} public grant(s)` : "ACL: Private");
        } catch (e: any) { results.push(`ACL: ${e.message}`); }
        return `Bucket "${params.bucketName}":\n${results.join("\n")}`;
      }
      case "set_bucket_public_access": {
        if (!params.bucketName) return "ERROR: bucketName is required.";
        const blockAll = params.blockAll !== "false";
        await s3.send(new PutPublicAccessBlockCommand({ Bucket: params.bucketName, PublicAccessBlockConfiguration: { BlockPublicAcls: blockAll, IgnorePublicAcls: blockAll, BlockPublicPolicy: blockAll, RestrictPublicBuckets: blockAll } }));
        return `Public access for "${params.bucketName}": ${blockAll ? "ALL BLOCKED (private)" : "ALLOWED"}`;
      }
      case "set_bucket_policy": {
        if (!params.bucketName) return "ERROR: bucketName is required.";
        if (!params.policy) { await s3.send(new DeleteBucketPolicyCommand({ Bucket: params.bucketName })); return `Bucket policy deleted for "${params.bucketName}".`; }
        await s3.send(new PutBucketPolicyCommand({ Bucket: params.bucketName, Policy: params.policy }));
        return `Bucket policy updated for "${params.bucketName}".`;
      }
      case "set_bucket_versioning": {
        if (!params.bucketName) return "ERROR: bucketName is required.";
        const status = params.enabled === "false" ? "Suspended" : "Enabled";
        await s3.send(new PutBucketVersioningCommand({ Bucket: params.bucketName, VersioningConfiguration: { Status: status } }));
        return `Versioning ${status.toLowerCase()} for "${params.bucketName}".`;
      }
      // === Lambda ===
      case "list_lambda_functions": {
        const res = await lambdaClient.send(new ListFunctionsCommand({}));
        const fns = res.Functions ?? [];
        if (fns.length === 0) return "No Lambda functions found.";
        return fns.map(f => `${f.FunctionName} | ${f.Runtime} | ${f.MemorySize}MB | Timeout: ${f.Timeout}s | Last: ${f.LastModified}`).join("\n");
      }
      case "get_lambda_function": {
        if (!params.functionName) return "ERROR: functionName is required.";
        const res = await lambdaClient.send(new GetFunctionCommand({ FunctionName: params.functionName }));
        const c = res.Configuration;
        return `Function: ${c?.FunctionName}\nRuntime: ${c?.Runtime}\nMemory: ${c?.MemorySize}MB\nTimeout: ${c?.Timeout}s\nHandler: ${c?.Handler}\nRole: ${c?.Role}\nCodeSize: ${((c?.CodeSize ?? 0) / 1024).toFixed(1)}KB\nLastModified: ${c?.LastModified}\nState: ${c?.State}`;
      }
      case "delete_lambda_function": {
        if (!params.functionName) return "ERROR: functionName is required.";
        await lambdaClient.send(new DeleteFunctionCommand({ FunctionName: params.functionName }));
        return `Lambda function "${params.functionName}" deleted.`;
      }
      case "invoke_lambda": {
        if (!params.functionName) return "ERROR: functionName is required.";
        const res = await lambdaClient.send(new LambdaInvokeCommand({ FunctionName: params.functionName, Payload: params.payload ? Buffer.from(params.payload) : undefined }));
        const payload = res.Payload ? Buffer.from(res.Payload).toString() : "no response";
        return `Invoked "${params.functionName}" | Status: ${res.StatusCode} | Response: ${payload.slice(0, 500)}`;
      }
      case "update_lambda_config": {
        if (!params.functionName) return "ERROR: functionName is required.";
        const upd: any = { FunctionName: params.functionName };
        if (params.timeout) upd.Timeout = parseInt(params.timeout);
        if (params.memorySize) upd.MemorySize = parseInt(params.memorySize);
        if (params.description) upd.Description = params.description;
        await lambdaClient.send(new UpdateFunctionConfigurationCommand(upd));
        return `Lambda "${params.functionName}" config updated.`;
      }
      // === IAM ===
      case "list_iam_roles": {
        const res = await iam.send(new ListRolesCommand({}));
        return (res.Roles ?? []).map(r => `${r.RoleName} | Created: ${r.CreateDate?.toISOString().split("T")[0]}`).join("\n") || "No IAM roles found.";
      }
      case "list_iam_users": {
        const res = await iam.send(new ListUsersCommand({}));
        return (res.Users ?? []).map(u => `${u.UserName} | Created: ${u.CreateDate?.toISOString().split("T")[0]} | ARN: ${u.Arn}`).join("\n") || "No IAM users found.";
      }
      case "list_iam_policies": {
        const res = await iam.send(new ListPoliciesCommand({ Scope: "Local" }));
        return (res.Policies ?? []).map(p => `${p.PolicyName} | ARN: ${p.Arn} | Attached: ${p.AttachmentCount}`).join("\n") || "No customer-managed policies found.";
      }
      case "get_iam_user": {
        if (!params.userName) return "ERROR: userName is required.";
        const res = await iam.send(new GetUserCommand({ UserName: params.userName }));
        const u = res.User;
        return `User: ${u?.UserName}\nARN: ${u?.Arn}\nCreated: ${u?.CreateDate?.toISOString()}\nPasswordLastUsed: ${u?.PasswordLastUsed?.toISOString() ?? "never"}`;
      }
      case "create_iam_user": {
        if (!params.userName) return "ERROR: userName is required.";
        const res = await iam.send(new CreateUserCommand({ UserName: params.userName }));
        return `IAM user "${res.User?.UserName}" created. ARN: ${res.User?.Arn}`;
      }
      case "delete_iam_user": {
        if (!params.userName) return "ERROR: userName is required.";
        await iam.send(new DeleteUserCommand({ UserName: params.userName }));
        return `IAM user "${params.userName}" deleted.`;
      }
      case "create_iam_role": {
        if (!params.roleName || !params.assumeRolePolicy) return "ERROR: roleName and assumeRolePolicy (JSON) are required.";
        const res = await iam.send(new CreateRoleCommand({ RoleName: params.roleName, AssumeRolePolicyDocument: params.assumeRolePolicy }));
        return `IAM role "${res.Role?.RoleName}" created. ARN: ${res.Role?.Arn}`;
      }
      case "delete_iam_role": {
        if (!params.roleName) return "ERROR: roleName is required.";
        await iam.send(new DeleteRoleCommand({ RoleName: params.roleName }));
        return `IAM role "${params.roleName}" deleted.`;
      }
      case "attach_role_policy": {
        if (!params.roleName || !params.policyArn) return "ERROR: roleName and policyArn are required.";
        await iam.send(new AttachRolePolicyCommand({ RoleName: params.roleName, PolicyArn: params.policyArn }));
        return `Policy ${params.policyArn} attached to role ${params.roleName}.`;
      }
      case "detach_role_policy": {
        if (!params.roleName || !params.policyArn) return "ERROR: roleName and policyArn are required.";
        await iam.send(new DetachRolePolicyCommand({ RoleName: params.roleName, PolicyArn: params.policyArn }));
        return `Policy detached from role ${params.roleName}.`;
      }
      case "attach_user_policy": {
        if (!params.userName || !params.policyArn) return "ERROR: userName and policyArn are required.";
        await iam.send(new AttachUserPolicyCommand({ UserName: params.userName, PolicyArn: params.policyArn }));
        return `Policy ${params.policyArn} attached to user ${params.userName}.`;
      }
      case "detach_user_policy": {
        if (!params.userName || !params.policyArn) return "ERROR: userName and policyArn are required.";
        await iam.send(new DetachUserPolicyCommand({ UserName: params.userName, PolicyArn: params.policyArn }));
        return `Policy detached from user ${params.userName}.`;
      }
      case "list_role_policies": {
        if (!params.roleName) return "ERROR: roleName is required.";
        const res = await iam.send(new ListAttachedRolePoliciesCommand({ RoleName: params.roleName }));
        return (res.AttachedPolicies ?? []).map(p => `${p.PolicyName} | ${p.PolicyArn}`).join("\n") || "No policies attached.";
      }
      case "list_user_policies": {
        if (!params.userName) return "ERROR: userName is required.";
        const res = await iam.send(new ListAttachedUserPoliciesCommand({ UserName: params.userName }));
        return (res.AttachedPolicies ?? []).map(p => `${p.PolicyName} | ${p.PolicyArn}`).join("\n") || "No policies attached.";
      }
      case "list_access_keys": {
        if (!params.userName) return "ERROR: userName is required.";
        const res = await iam.send(new ListAccessKeysCommand({ UserName: params.userName }));
        return (res.AccessKeyMetadata ?? []).map(k => `${k.AccessKeyId} | Status: ${k.Status} | Created: ${k.CreateDate?.toISOString().split("T")[0]}`).join("\n") || "No access keys.";
      }
      case "create_access_key": {
        if (!params.userName) return "ERROR: userName is required.";
        const res = await iam.send(new CreateAccessKeyCommand({ UserName: params.userName }));
        return `Access key created for ${params.userName}:\nAccessKeyId: ${res.AccessKey?.AccessKeyId}\nSecretAccessKey: ${res.AccessKey?.SecretAccessKey}\nSAVE THE SECRET KEY NOW — it cannot be retrieved again.`;
      }
      case "delete_access_key": {
        if (!params.userName || !params.accessKeyId) return "ERROR: userName and accessKeyId are required.";
        await iam.send(new DeleteAccessKeyCommand({ UserName: params.userName, AccessKeyId: params.accessKeyId }));
        return `Access key ${params.accessKeyId} deleted for ${params.userName}.`;
      }
      // === RDS ===
      case "list_rds_instances": {
        const res = await rds.send(new DescribeDBInstancesCommand({}));
        const dbs = res.DBInstances ?? [];
        if (dbs.length === 0) return "No RDS instances found.";
        return dbs.map(d => `${d.DBInstanceIdentifier} | ${d.Engine} ${d.EngineVersion} | ${d.DBInstanceClass} | ${d.DBInstanceStatus} | ${d.Endpoint?.Address ?? "no endpoint"}`).join("\n");
      }
      case "stop_rds_instance": {
        if (!params.dbInstanceId) return "ERROR: dbInstanceId is required.";
        await rds.send(new StopDBInstanceCommand({ DBInstanceIdentifier: params.dbInstanceId }));
        return `RDS instance ${params.dbInstanceId} is being stopped.`;
      }
      case "start_rds_instance": {
        if (!params.dbInstanceId) return "ERROR: dbInstanceId is required.";
        await rds.send(new StartDBInstanceCommand({ DBInstanceIdentifier: params.dbInstanceId }));
        return `RDS instance ${params.dbInstanceId} is being started.`;
      }
      case "list_rds_snapshots": {
        const res = await rds.send(new DescribeDBSnapshotsCommand({ SnapshotType: "manual" }));
        return (res.DBSnapshots ?? []).map(s => `${s.DBSnapshotIdentifier} | ${s.DBInstanceIdentifier} | ${s.Engine} | ${s.Status} | ${s.SnapshotCreateTime?.toISOString().split("T")[0]}`).join("\n") || "No RDS snapshots found.";
      }
      case "create_rds_snapshot": {
        if (!params.dbInstanceId || !params.snapshotId) return "ERROR: dbInstanceId and snapshotId are required.";
        await rds.send(new CreateDBSnapshotCommand({ DBInstanceIdentifier: params.dbInstanceId, DBSnapshotIdentifier: params.snapshotId }));
        return `RDS snapshot "${params.snapshotId}" is being created for ${params.dbInstanceId}.`;
      }
      // === DynamoDB ===
      case "list_dynamodb_tables": {
        const res = await ddb.send(new ListTablesCommand({}));
        const tableNames = res.TableNames ?? [];
        if (tableNames.length === 0) return "No DynamoDB tables found.";
        const details: string[] = [];
        for (const tn of tableNames) {
          try {
            const desc = await ddb.send(new DescribeTableCommand({ TableName: tn }));
            const t = desc.Table;
            const keys = (t?.KeySchema ?? []).map(k => `${k.AttributeName} (${k.KeyType})`).join(", ");
            details.push(`${tn} | ${t?.TableStatus} | Keys: ${keys} | Items: ${t?.ItemCount ?? 0} | Size: ${((t?.TableSizeBytes ?? 0) / 1024).toFixed(1)}KB | Created: ${t?.CreationDateTime?.toISOString().split("T")[0]}`);
          } catch { details.push(`${tn} | Could not describe`); }
        }
        return details.join("\n");
      }
      case "describe_dynamodb_table": {
        if (!params.tableName) return "ERROR: tableName is required.";
        const desc = await ddb.send(new DescribeTableCommand({ TableName: params.tableName }));
        const t = desc.Table;
        const keys = (t?.KeySchema ?? []).map(k => `${k.AttributeName} (${k.KeyType})`).join(", ");
        const attrs = (t?.AttributeDefinitions ?? []).map(a => `${a.AttributeName}: ${a.AttributeType}`).join(", ");
        const gsi = (t?.GlobalSecondaryIndexes ?? []).map(g => `${g.IndexName} (${g.KeySchema?.map(k => k.AttributeName).join(",")})`).join(", ");
        return `Table: ${t?.TableName}\nStatus: ${t?.TableStatus}\nKeys: ${keys}\nAttributes: ${attrs}\nItems: ${t?.ItemCount}\nSize: ${((t?.TableSizeBytes ?? 0) / 1024).toFixed(1)}KB\nGSIs: ${gsi || "none"}\nCreated: ${t?.CreationDateTime?.toISOString()}`;
      }
      case "delete_dynamodb_table": {
        if (!params.tableName) return "ERROR: tableName is required.";
        await ddb.send(new DeleteTableCommand({ TableName: params.tableName }));
        return `DynamoDB table "${params.tableName}" is being deleted.`;
      }
      case "create_dynamodb_table": {
        if (!params.tableName || !params.partitionKey) return "ERROR: tableName and partitionKey are required.";
        const keySchema: any[] = [{ AttributeName: params.partitionKey, KeyType: "HASH" }];
        const attrDefs: any[] = [{ AttributeName: params.partitionKey, AttributeType: params.partitionKeyType || "S" }];
        if (params.sortKey) { keySchema.push({ AttributeName: params.sortKey, KeyType: "RANGE" }); attrDefs.push({ AttributeName: params.sortKey, AttributeType: params.sortKeyType || "S" }); }
        await ddb.send(new CreateTableCommand({ TableName: params.tableName, KeySchema: keySchema, AttributeDefinitions: attrDefs, BillingMode: "PAY_PER_REQUEST" }));
        return `DynamoDB table "${params.tableName}" created with PAY_PER_REQUEST billing.`;
      }
      case "scan_dynamodb_table": {
        if (!params.tableName) return "ERROR: tableName is required.";
        const limit = parseInt(params.limit || "10");
        const res = await ddb.send(new ScanCommand({ TableName: params.tableName, Limit: limit }));
        const items = res.Items ?? [];
        if (items.length === 0) return `No items found in "${params.tableName}".`;
        return `${items.length} items (of ${res.Count} scanned):\n${items.map(item => JSON.stringify(item)).join("\n")}`;
      }
      // === CloudWatch Logs ===
      case "list_log_groups": {
        const res = await logs.send(new DescribeLogGroupsCommand({}));
        return (res.logGroups ?? []).map(lg => `${lg.logGroupName} | ${((lg.storedBytes ?? 0) / 1024 / 1024).toFixed(1)}MB | Retention: ${lg.retentionInDays ?? "never expires"}`).join("\n") || "No log groups found.";
      }
      case "create_log_group": {
        if (!params.logGroupName) return "ERROR: logGroupName is required.";
        await logs.send(new CreateLogGroupCommand({ logGroupName: params.logGroupName }));
        return `Log group "${params.logGroupName}" created.`;
      }
      case "delete_log_group": {
        if (!params.logGroupName) return "ERROR: logGroupName is required.";
        await logs.send(new DeleteLogGroupCommand({ logGroupName: params.logGroupName }));
        return `Log group "${params.logGroupName}" deleted.`;
      }
      case "list_log_streams": {
        if (!params.logGroupName) return "ERROR: logGroupName is required.";
        const res = await logs.send(new DescribeLogStreamsCommand({ logGroupName: params.logGroupName, orderBy: "LastEventTime", descending: true, limit: 20 }));
        return (res.logStreams ?? []).map(s => `${s.logStreamName} | Last event: ${s.lastEventTimestamp ? new Date(s.lastEventTimestamp).toISOString() : "none"}`).join("\n") || "No log streams found.";
      }
      case "get_log_events": {
        if (!params.logGroupName || !params.logStreamName) return "ERROR: logGroupName and logStreamName are required.";
        const res = await logs.send(new GetLogEventsCommand({ logGroupName: params.logGroupName, logStreamName: params.logStreamName, limit: parseInt(params.limit || "20"), startFromHead: false }));
        return (res.events ?? []).map(e => `[${new Date(e.timestamp ?? 0).toISOString()}] ${e.message}`).join("\n") || "No log events found.";
      }
      // === SNS ===
      case "list_sns_topics": {
        const res = await sns.send(new ListTopicsCommand({}));
        return (res.Topics ?? []).map(t => t.TopicArn).join("\n") || "No SNS topics found.";
      }
      case "create_sns_topic": {
        if (!params.topicName) return "ERROR: topicName is required.";
        const res = await sns.send(new CreateTopicCommand({ Name: params.topicName }));
        return `SNS topic created! ARN: ${res.TopicArn}`;
      }
      case "delete_sns_topic": {
        if (!params.topicArn) return "ERROR: topicArn is required.";
        await sns.send(new DeleteTopicCommand({ TopicArn: params.topicArn }));
        return `SNS topic deleted.`;
      }
      case "list_sns_subscriptions": {
        const res = await sns.send(new ListSubscriptionsCommand({}));
        return (res.Subscriptions ?? []).map(s => `${s.SubscriptionArn} | ${s.Protocol} | ${s.Endpoint} | Topic: ${s.TopicArn}`).join("\n") || "No subscriptions found.";
      }
      case "subscribe_sns": {
        if (!params.topicArn || !params.protocol || !params.endpoint) return "ERROR: topicArn, protocol, and endpoint are required.";
        const res = await sns.send(new SubscribeCommand({ TopicArn: params.topicArn, Protocol: params.protocol, Endpoint: params.endpoint }));
        return `Subscribed! ARN: ${res.SubscriptionArn}`;
      }
      case "publish_sns": {
        if (!params.topicArn || !params.message) return "ERROR: topicArn and message are required.";
        const res = await sns.send(new PublishCommand({ TopicArn: params.topicArn, Message: params.message, Subject: params.subject || undefined }));
        return `Message published! MessageId: ${res.MessageId}`;
      }
      // === SQS ===
      case "list_sqs_queues": {
        const res = await sqs.send(new ListQueuesCommand({}));
        return (res.QueueUrls ?? []).join("\n") || "No SQS queues found.";
      }
      case "create_sqs_queue": {
        if (!params.queueName) return "ERROR: queueName is required.";
        const res = await sqs.send(new CreateQueueCommand({ QueueName: params.queueName }));
        return `SQS queue created! URL: ${res.QueueUrl}`;
      }
      case "delete_sqs_queue": {
        if (!params.queueUrl) return "ERROR: queueUrl is required.";
        await sqs.send(new DeleteQueueCommand({ QueueUrl: params.queueUrl }));
        return `SQS queue deleted.`;
      }
      case "get_sqs_attributes": {
        if (!params.queueUrl) return "ERROR: queueUrl is required.";
        const res = await sqs.send(new GetQueueAttributesCommand({ QueueUrl: params.queueUrl, AttributeNames: ["All"] }));
        const attrs = res.Attributes ?? {};
        return Object.entries(attrs).map(([k, v]) => `${k}: ${v}`).join("\n") || "No attributes.";
      }
      case "send_sqs_message": {
        if (!params.queueUrl || !params.messageBody) return "ERROR: queueUrl and messageBody are required.";
        const res = await sqs.send(new SendMessageCommand({ QueueUrl: params.queueUrl, MessageBody: params.messageBody }));
        return `Message sent! MessageId: ${res.MessageId}`;
      }
      // === CloudFormation ===
      case "list_cfn_stacks": {
        const res = await cfn.send(new ListStacksCommand({ StackStatusFilter: ["CREATE_COMPLETE", "UPDATE_COMPLETE", "UPDATE_ROLLBACK_COMPLETE", "ROLLBACK_COMPLETE"] }));
        return (res.StackSummaries ?? []).map(s => `${s.StackName} | ${s.StackStatus} | Created: ${s.CreationTime?.toISOString().split("T")[0]}`).join("\n") || "No stacks found.";
      }
      case "describe_cfn_stack": {
        if (!params.stackName) return "ERROR: stackName is required.";
        const res = await cfn.send(new DescribeStacksCommand({ StackName: params.stackName }));
        const st = res.Stacks?.[0];
        if (!st) return "Stack not found.";
        const outputs = (st.Outputs ?? []).map(o => `  ${o.OutputKey}: ${o.OutputValue}`).join("\n");
        return `Stack: ${st.StackName}\nStatus: ${st.StackStatus}\nCreated: ${st.CreationTime?.toISOString()}\nUpdated: ${st.LastUpdatedTime?.toISOString() ?? "never"}\nOutputs:\n${outputs || "  none"}`;
      }
      case "delete_cfn_stack": {
        if (!params.stackName) return "ERROR: stackName is required.";
        await cfn.send(new DeleteStackCommand({ StackName: params.stackName }));
        return `CloudFormation stack "${params.stackName}" is being deleted.`;
      }
      // === CloudWatch Alarms ===
      case "list_cw_alarms": {
        const res = await cw.send(new DescribeAlarmsCommand({}));
        return (res.MetricAlarms ?? []).map(a => `${a.AlarmName} | ${a.StateValue} | ${a.MetricName} ${a.ComparisonOperator} ${a.Threshold} | ${a.Namespace}`).join("\n") || "No alarms found.";
      }
      case "create_cw_alarm": {
        if (!params.alarmName || !params.metricName || !params.namespace || !params.threshold) return "ERROR: alarmName, metricName, namespace, threshold are required.";
        await cw.send(new PutMetricAlarmCommand({ AlarmName: params.alarmName, MetricName: params.metricName, Namespace: params.namespace, Threshold: parseFloat(params.threshold), ComparisonOperator: (params.comparisonOperator || "GreaterThanThreshold") as any, Period: parseInt(params.period || "300"), EvaluationPeriods: parseInt(params.evaluationPeriods || "1"), Statistic: (params.statistic || "Average") as any }));
        return `CloudWatch alarm "${params.alarmName}" created.`;
      }
      case "delete_cw_alarm": {
        if (!params.alarmNames) return "ERROR: alarmNames (comma-separated) is required.";
        await cw.send(new DeleteAlarmsCommand({ AlarmNames: params.alarmNames.split(",").map(s => s.trim()) }));
        return `Alarm(s) deleted.`;
      }
      // === Route53 ===
      case "list_hosted_zones": {
        const res = await route53.send(new ListHostedZonesCommand({}));
        return (res.HostedZones ?? []).map(z => `${z.Id} | ${z.Name} | Records: ${z.ResourceRecordSetCount} | ${z.Config?.PrivateZone ? "Private" : "Public"}`).join("\n") || "No hosted zones found.";
      }
      case "list_dns_records": {
        if (!params.hostedZoneId) return "ERROR: hostedZoneId is required.";
        const res = await route53.send(new ListResourceRecordSetsCommand({ HostedZoneId: params.hostedZoneId }));
        return (res.ResourceRecordSets ?? []).map(r => `${r.Name} | ${r.Type} | TTL: ${r.TTL ?? "alias"} | ${r.ResourceRecords?.map(rr => rr.Value).join(", ") ?? r.AliasTarget?.DNSName ?? ""}`).join("\n") || "No records found.";
      }
      // === ECS ===
      case "list_ecs_clusters": {
        const res = await ecs.send(new ListClustersCommand({}));
        const arns = res.clusterArns ?? [];
        if (arns.length === 0) return "No ECS clusters found.";
        const desc = await ecs.send(new DescribeClustersCommand({ clusters: arns }));
        return (desc.clusters ?? []).map(c => `${c.clusterName} | Status: ${c.status} | Services: ${c.activeServicesCount} | Tasks: ${c.runningTasksCount}`).join("\n");
      }
      case "describe_ecs_cluster": {
        if (!params.clusterArn) return "ERROR: clusterArn is required.";
        const res = await ecs.send(new DescribeClustersCommand({ clusters: [params.clusterArn] }));
        const c = res.clusters?.[0];
        if (!c) return "Cluster not found.";
        return `Cluster: ${c.clusterName}\nStatus: ${c.status}\nServices: ${c.activeServicesCount}\nRunning Tasks: ${c.runningTasksCount}\nPending Tasks: ${c.pendingTasksCount}\nRegistered Instances: ${c.registeredContainerInstancesCount}`;
      }
      // === Account / Cost ===
      case "get_account_id": {
        const res = await sts.send(new GetCallerIdentityCommand({}));
        return `Account: ${res.Account}\nARN: ${res.Arn}\nUserId: ${res.UserId}`;
      }
      case "get_cost_last_30_days": {
        const end = new Date(); const start = new Date(); start.setDate(start.getDate() - 30);
        const res = await costExplorer.send(new GetCostAndUsageCommand({ TimePeriod: { Start: start.toISOString().split("T")[0], End: end.toISOString().split("T")[0] }, Granularity: "MONTHLY", Metrics: ["UnblendedCost"], GroupBy: [{ Type: "DIMENSION", Key: "SERVICE" }] }));
        const results: string[] = [];
        for (const period of res.ResultsByTime ?? []) {
          for (const group of period.Groups ?? []) {
            const svc = group.Keys?.[0] ?? "Unknown";
            const cost = parseFloat(group.Metrics?.UnblendedCost?.Amount ?? "0");
            if (cost > 0.01) results.push(`${svc}: $${cost.toFixed(2)}`);
          }
        }
        return results.length > 0 ? `AWS costs (last 30 days):\n${results.sort((a, b) => parseFloat(b.split("$")[1]) - parseFloat(a.split("$")[1])).join("\n")}` : "No cost data available.";
      }
      // === CloudGuardian ===
      case "get_scan_summary": {
        const scans = await repo.listScans();
        const completed = scans.filter(s => s.status === "COMPLETED").sort((a, b) => b.startTime > a.startTime ? 1 : -1);
        if (completed.length === 0) return "No completed scans found.";
        const latest = completed[0];
        return `Latest scan: ${latest.scanId}\nStatus: ${latest.status}\nStarted: ${latest.startTime}\nResources: ${latest.resourcesEvaluated}\nFindings: ${latest.recommendationCount}\nRegions: ${latest.regionsScanned?.join(", ")}`;
      }
      case "get_recommendations": {
        const scans = await repo.listScans();
        const completed = scans.filter(s => s.status === "COMPLETED").sort((a, b) => b.startTime > a.startTime ? 1 : -1);
        if (completed.length === 0) return "No completed scans found.";
        const recs = await repo.queryRecommendationsByScan(completed[0].scanId);
        if (recs.length === 0) return "No recommendations found.";
        return recs.slice(0, 20).map(r => `[${r.riskLevel}] ${r.resourceType}: ${r.resourceId} — ${r.issueDescription}`).join("\n");
      }
      default:
        return `Unknown tool: ${name}`;
    }
  } catch (err: any) {
    return `Error executing ${name}: ${err.message}`;
  }
}

const SYSTEM_PROMPT = `You are CloudGuardian Assistant, a fully capable AWS cloud management AI. You can manage virtually ANY AWS resource through natural conversation.

You have ${TOOLS.length} tools covering: EC2, EBS, VPC, Security Groups, Elastic IPs, S3, Lambda, IAM (users/roles/policies/access keys), RDS, DynamoDB, CloudWatch Logs, SNS, SQS, CloudFormation, CloudWatch Alarms, Route53, ECS, Cost Explorer, and CloudGuardian scans.

Available tools:
${TOOLS.map(t => `- ${t.name}: ${t.description}`).join("\n")}

CRITICAL RULES:
1. NEVER fabricate AWS resource data. ALWAYS call the appropriate tool. If you show resource info without a tool call, you are LYING.
2. When asked about ANY AWS resources, ALWAYS respond with a TOOL_CALL first.
3. For destructive actions (delete, terminate, stop), confirm with the user first.
4. If a tool needs parameters the user hasn't provided, ASK for them.
5. To call a tool, use EXACTLY: TOOL_CALL:tool_name:{"param":"value"}
6. After tool results, summarize naturally using ONLY the real data.
7. Multiple tools: one TOOL_CALL per line.
8. For create operations, execute immediately if user gave required params. For delete/stop/terminate, confirm first.
9. NEVER use markdown formatting. No asterisks, backticks, or hash symbols. Use CAPS or dashes for emphasis.
10. When analyzing uploaded files, describe thoroughly.
11. NEVER generate fake data like "example-table-1" or "i-1234567890abcdef0".
12. You CAN upload files to S3, create/delete resources, manage IAM, invoke Lambda, send SNS/SQS messages, and more.
13. For S3 uploads, use upload_to_s3 with the attached files.
14. Always output TOOL_CALL with valid JSON.`;

function detectRequiredTools(msg: string): { name: string; params: Record<string, string> }[] {
  const tools: { name: string; params: Record<string, string> }[] = [];
  const patterns: [RegExp, string][] = [
    [/\b(dynamodb|dynamo|ddb)\b.*\b(table)/i, "list_dynamodb_tables"],
    [/\b(list|show|get|what|display|my)\b.*\b(ec2|instance|server)/i, "list_ec2_instances"],
    [/\b(list|show|get|what|display|my)\b.*\b(s3|bucket)/i, "list_s3_buckets"],
    [/\b(list|show|get|what|display|my)\b.*\b(lambda|function)/i, "list_lambda_functions"],
    [/\b(list|show|get|what|display|my)\b.*\b(iam)\b.*\b(role)/i, "list_iam_roles"],
    [/\b(list|show|get|what|display|my)\b.*\b(iam)\b.*\b(user)/i, "list_iam_users"],
    [/\b(list|show|get|what|display|my)\b.*\b(iam)\b.*\b(polic)/i, "list_iam_policies"],
    [/\b(list|show|get|what|display|my)\b.*\b(rds|database)/i, "list_rds_instances"],
    [/\b(list|show|get|what|display|my)\b.*\b(ebs|volume)/i, "list_ebs_volumes"],
    [/\b(list|show|get|what|display|my)\b.*\b(security group)/i, "list_security_groups"],
    [/\b(list|show|get|what|display|my)\b.*\b(elastic ip|eip)/i, "list_elastic_ips"],
    [/\b(list|show|get|what|display|my)\b.*\b(log group|cloudwatch log)/i, "list_log_groups"],
    [/\b(list|show|get|what|display|my)\b.*\b(vpc)/i, "list_vpcs"],
    [/\b(list|show|get|what|display|my)\b.*\b(subnet)/i, "list_subnets"],
    [/\b(list|show|get|what|display|my)\b.*\b(sns|topic)/i, "list_sns_topics"],
    [/\b(list|show|get|what|display|my)\b.*\b(sqs|queue)/i, "list_sqs_queues"],
    [/\b(list|show|get|what|display|my)\b.*\b(stack|cloudformation|cfn)/i, "list_cfn_stacks"],
    [/\b(list|show|get|what|display|my)\b.*\b(alarm)/i, "list_cw_alarms"],
    [/\b(list|show|get|what|display|my)\b.*\b(hosted zone|route53|dns)/i, "list_hosted_zones"],
    [/\b(list|show|get|what|display|my)\b.*\b(ecs|cluster)/i, "list_ecs_clusters"],
    [/\b(list|show|get|what|display|my)\b.*\b(snapshot)/i, "list_snapshots"],
    [/\b(list|show|get|what|display|my)\b.*\b(key pair)/i, "list_key_pairs"],
    [/\b(list|show|get|what|display|my)\b.*\b(access key)/i, "list_access_keys"],
    [/\b(cost|bill|spend|expense|pricing)/i, "get_cost_last_30_days"],
    [/\b(account id|caller identity|who am i)/i, "get_account_id"],
    [/\b(scan|finding|recommendation)/i, "get_scan_summary"],
  ];
  for (const [pattern, toolName] of patterns) {
    if (pattern.test(msg)) { tools.push({ name: toolName, params: {} }); break; }
  }
  return tools;
}

export async function handleAssistant(body: AssistantRequest): Promise<AssistantResponse> {
  const { message, history = [], attachments = [] } = body;

  const messages: any[] = history.map(m => ({
    role: m.role as "user" | "assistant",
    content: [{ text: m.content }],
  }));

  const userContent: any[] = [];
  for (const att of attachments) {
    const bytes = Buffer.from(att.data, "base64");
    if (att.type === "image") userContent.push({ image: { format: att.format as any, source: { bytes } } });
    else if (att.type === "video") userContent.push({ video: { format: att.format as any, source: { bytes } } });
    else if (att.type === "document") userContent.push({ document: { format: att.format as any, name: (att.name || "document").replace(/[^a-zA-Z0-9_\-]/g, "_").slice(0, 100), source: { bytes } } });
  }
  if (message) userContent.push({ text: message });
  else if (userContent.length > 0) userContent.push({ text: "Please analyze this file." });

  messages.push({ role: "user" as const, content: userContent });

  let response = await bedrock.send(new ConverseCommand({
    modelId: "amazon.nova-lite-v1:0",
    system: [{ text: SYSTEM_PROMPT }],
    messages,
    inferenceConfig: { maxTokens: 2048, temperature: 0.3 },
  }));

  let reply = response.output?.message?.content?.[0]?.text ?? "";

  const toolCallRegex = /TOOL_CALL:(\w+):\s*(\{[^}]*\})/g;
  let match;
  const toolResults: string[] = [];
  const processedTools = new Set<string>();

  while ((match = toolCallRegex.exec(reply)) !== null) {
    const toolName = match[1];
    let params: Record<string, string> = {};
    try { params = JSON.parse(match[2]); } catch {}
    const result = await executeTool(toolName, params, attachments);
    toolResults.push(`[${toolName} result]:\n${result}`);
    processedTools.add(toolName);
  }

  if (toolResults.length === 0) {
    const simpleRegex = /TOOL_CALL:(\w+)/g;
    let simpleMatch;
    while ((simpleMatch = simpleRegex.exec(reply)) !== null) {
      const toolName = simpleMatch[1];
      if (TOOLS.some(t => t.name === toolName) && !processedTools.has(toolName)) {
        const result = await executeTool(toolName, {}, attachments);
        toolResults.push(`[${toolName} result]:\n${result}`);
        processedTools.add(toolName);
      }
    }
  }

  // Fallback: force tool call if model hallucinated instead
  if (toolResults.length === 0) {
    const detected = detectRequiredTools(message);
    for (const dt of detected) {
      const result = await executeTool(dt.name, dt.params, attachments);
      toolResults.push(`[${dt.name} result]:\n${result}`);
      processedTools.add(dt.name);
    }
  }

  if (toolResults.length > 0) {
    const modelCalledTools = /TOOL_CALL/.test(reply);
    messages.push({ role: "assistant" as const, content: [{ text: modelCalledTools ? reply : "Let me look that up for you." }] });
    messages.push({ role: "user" as const, content: [{ text: `Tool results:\n${toolResults.join("\n\n")}\n\nSummarize these REAL results naturally. ONLY use data from above. No fake data. No TOOL_CALL. No markdown.` }] });

    response = await bedrock.send(new ConverseCommand({
      modelId: "amazon.nova-lite-v1:0",
      system: [{ text: SYSTEM_PROMPT }],
      messages,
      inferenceConfig: { maxTokens: 2048, temperature: 0.3 },
    }));
    reply = response.output?.message?.content?.[0]?.text ?? reply;
  }

  reply = reply.replace(/TOOL_CALL:\w+:?\s*\{[^}]*\}/g, "").replace(/TOOL_CALL:\w+/g, "").trim();
  return { reply };
}
