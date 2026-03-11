import type { Instance, Volume, SecurityGroup } from "@aws-sdk/client-ec2";
import type { User, Role } from "@aws-sdk/client-iam";
import type { FunctionConfiguration } from "@aws-sdk/client-lambda";
import type { DBInstance } from "@aws-sdk/client-rds";
import type { LoadBalancer } from "@aws-sdk/client-elastic-load-balancing-v2";

export type PropertyMap = Record<string, unknown>;

/** Metadata for IAM users that isn't on the base User type */
export interface IAMUserMetadata {
  mfaEnabled: boolean;
  accessKeyAge?: number;
}

/**
 * Converts AWS SDK tag arrays ({Key, Value}[]) to a flat Record<string, string>.
 */
function convertTags(
  tags?: { Key?: string; Value?: string }[]
): Record<string, string> {
  const result: Record<string, string> = {};
  if (!tags) return result;
  for (const tag of tags) {
    if (tag.Key != null) {
      result[tag.Key] = tag.Value ?? "";
    }
  }
  return result;
}

export function mapEC2Properties(instance: Instance): PropertyMap {
  return {
    InstanceType: instance.InstanceType,
    State: instance.State?.Name,
    PublicIpAddress: instance.PublicIpAddress,
    Tags: convertTags(instance.Tags),
    VpcId: instance.VpcId,
    SubnetId: instance.SubnetId,
    ImageId: instance.ImageId,
    LaunchTime: instance.LaunchTime?.toISOString(),
  };
}

export function mapEBSProperties(volume: Volume): PropertyMap {
  return {
    VolumeType: volume.VolumeType,
    Size: volume.Size,
    State: volume.State,
    Encrypted: volume.Encrypted,
    Iops: volume.Iops,
  };
}

export function mapSecurityGroupProperties(sg: SecurityGroup): PropertyMap {
  return {
    GroupName: sg.GroupName,
    VpcId: sg.VpcId,
    InboundRuleCount: sg.IpPermissions?.length ?? 0,
    OutboundRuleCount: sg.IpPermissionsEgress?.length ?? 0,
    Tags: convertTags(sg.Tags),
  };
}

export function mapIAMUserProperties(
  user: User,
  metadata: IAMUserMetadata
): PropertyMap {
  return {
    UserName: user.UserName,
    MfaEnabled: metadata.mfaEnabled,
    AccessKeyAge: metadata.accessKeyAge,
    PasswordLastUsed: user.PasswordLastUsed?.toISOString(),
    Tags: convertTags(user.Tags),
  };
}

export function mapIAMRoleProperties(role: Role): PropertyMap {
  return {
    RoleName: role.RoleName,
    LastUsedDate: role.RoleLastUsed?.LastUsedDate?.toISOString(),
    AttachedPolicyCount: undefined, // Must be provided externally; SDK Role type doesn't include this
    Tags: convertTags(role.Tags),
  };
}

export function mapLambdaProperties(fn: FunctionConfiguration): PropertyMap {
  return {
    Runtime: fn.Runtime,
    MemorySize: fn.MemorySize,
    Timeout: fn.Timeout,
    CodeSize: fn.CodeSize,
    LastModified: fn.LastModified,
    Tags: undefined, // Lambda tags come from a separate API call; set externally if needed
  };
}

export function mapRDSProperties(instance: DBInstance): PropertyMap {
  return {
    DBInstanceClass: instance.DBInstanceClass,
    Engine: instance.Engine,
    MultiAZ: instance.MultiAZ,
    StorageEncrypted: instance.StorageEncrypted,
    PubliclyAccessible: instance.PubliclyAccessible,
    Tags: convertTags(instance.TagList),
  };
}

export function mapLoadBalancerProperties(lb: LoadBalancer): PropertyMap {
  return {
    Type: lb.Type,
    Scheme: lb.Scheme,
    State: lb.State?.Code,
    Tags: undefined, // ELBv2 tags come from a separate API call; set externally if needed
  };
}

export function mapS3BucketProperties(bucket: Record<string, unknown>): PropertyMap {
  return {
    BucketName: bucket.BucketName,
    VersioningEnabled: bucket.VersioningEnabled ?? false,
    PublicAccessBlocked: bucket.PublicAccessBlocked ?? false,
    EncryptionEnabled: bucket.EncryptionEnabled ?? false,
    Tags: bucket.Tags ?? {},
  };
}

export function mapVPCProperties(vpc: Record<string, unknown>): PropertyMap {
  return {
    CidrBlock: vpc.CidrBlock,
    State: vpc.State,
    IsDefault: vpc.IsDefault,
    Tags: convertTags(vpc.Tags as { Key?: string; Value?: string }[] | undefined),
  };
}

export function mapSubnetProperties(subnet: Record<string, unknown>): PropertyMap {
  return {
    CidrBlock: subnet.CidrBlock,
    AvailabilityZone: subnet.AvailabilityZone,
    MapPublicIpOnLaunch: subnet.MapPublicIpOnLaunch,
    State: subnet.State,
    VpcId: subnet.VpcId,
    Tags: convertTags(subnet.Tags as { Key?: string; Value?: string }[] | undefined),
  };
}

export function mapElasticIPProperties(eip: Record<string, unknown>): PropertyMap {
  return {
    PublicIp: eip.PublicIp,
    Associated: !!eip.AssociationId,
    AllocationId: eip.AllocationId,
    Tags: convertTags(eip.Tags as { Key?: string; Value?: string }[] | undefined),
  };
}

export function mapSNSTopicProperties(topic: Record<string, unknown>): PropertyMap {
  return {
    TopicName: topic.TopicName,
    SubscriptionCount: topic.SubscriptionCount,
    KmsMasterKeyId: topic.KmsMasterKeyId,
    Tags: topic.Tags ?? {},
  };
}

export function mapSQSQueueProperties(queue: Record<string, unknown>): PropertyMap {
  return {
    QueueName: queue.QueueName,
    VisibilityTimeout: queue.VisibilityTimeout,
    MessageRetentionPeriod: queue.MessageRetentionPeriod,
    EncryptionEnabled: !!queue.KmsMasterKeyId,
    Tags: queue.Tags ?? {},
  };
}

export function mapDynamoDBTableProperties(table: Record<string, unknown>): PropertyMap {
  return {
    TableName: table.TableName,
    TableStatus: table.TableStatus,
    BillingMode: table.BillingMode,
    ItemCount: table.ItemCount,
    TableSizeBytes: table.TableSizeBytes,
    Tags: table.Tags ?? {},
  };
}

export function mapCloudFrontDistributionProperties(dist: Record<string, unknown>): PropertyMap {
  return {
    DomainName: dist.DomainName,
    Status: dist.Status,
    Enabled: dist.Enabled,
    HttpVersion: dist.HttpVersion,
    PriceClass: dist.PriceClass,
  };
}

export function mapECSClusterProperties(cluster: Record<string, unknown>): PropertyMap {
  return {
    ClusterName: cluster.ClusterName,
    Status: cluster.Status,
    RunningTasksCount: cluster.RunningTasksCount,
    ActiveServicesCount: cluster.ActiveServicesCount,
    Tags: cluster.Tags ?? {},
  };
}

export function mapAutoScalingGroupProperties(asg: Record<string, unknown>): PropertyMap {
  return {
    AutoScalingGroupName: asg.AutoScalingGroupName,
    MinSize: asg.MinSize,
    MaxSize: asg.MaxSize,
    DesiredCapacity: asg.DesiredCapacity,
    HealthCheckType: asg.HealthCheckType,
    Tags: convertTags(asg.Tags as { Key?: string; Value?: string }[] | undefined),
  };
}

/** Returns the appropriate mapper function for a given resource type, or undefined if unsupported. */
export function getMapperForResourceType(
  resourceType: string
): ((...args: unknown[]) => PropertyMap) | undefined {
  switch (resourceType) {
    case "EC2Instance":
      return mapEC2Properties as (...args: unknown[]) => PropertyMap;
    case "EBSVolume":
      return mapEBSProperties as (...args: unknown[]) => PropertyMap;
    case "S3Bucket":
      return mapS3BucketProperties as (...args: unknown[]) => PropertyMap;
    case "SecurityGroup":
      return mapSecurityGroupProperties as (...args: unknown[]) => PropertyMap;
    case "IAMUser":
      return mapIAMUserProperties as (...args: unknown[]) => PropertyMap;
    case "IAMRole":
      return mapIAMRoleProperties as (...args: unknown[]) => PropertyMap;
    case "LambdaFunction":
      return mapLambdaProperties as (...args: unknown[]) => PropertyMap;
    case "RDSInstance":
      return mapRDSProperties as (...args: unknown[]) => PropertyMap;
    case "LoadBalancer":
      return mapLoadBalancerProperties as (...args: unknown[]) => PropertyMap;
    case "VPC":
      return mapVPCProperties as (...args: unknown[]) => PropertyMap;
    case "Subnet":
      return mapSubnetProperties as (...args: unknown[]) => PropertyMap;
    case "ElasticIP":
      return mapElasticIPProperties as (...args: unknown[]) => PropertyMap;
    case "SNSTopic":
      return mapSNSTopicProperties as (...args: unknown[]) => PropertyMap;
    case "SQSQueue":
      return mapSQSQueueProperties as (...args: unknown[]) => PropertyMap;
    case "DynamoDBTable":
      return mapDynamoDBTableProperties as (...args: unknown[]) => PropertyMap;
    case "CloudFrontDistribution":
      return mapCloudFrontDistributionProperties as (...args: unknown[]) => PropertyMap;
    case "ECSCluster":
      return mapECSClusterProperties as (...args: unknown[]) => PropertyMap;
    case "AutoScalingGroup":
      return mapAutoScalingGroupProperties as (...args: unknown[]) => PropertyMap;
    default:
      return undefined;
  }
}
