import {
  EC2Client,
  DescribeVolumesCommand,
  DescribeInstancesCommand,
  DescribeAddressesCommand,
  DescribeSecurityGroupsCommand,
  DescribeNetworkInterfacesCommand,
  DescribeSnapshotsCommand,
  DescribeImagesCommand,
  DescribeLaunchTemplateVersionsCommand,
  type Volume,
  type Instance,
  type Address,
  type SecurityGroup,
} from "@aws-sdk/client-ec2";
import {
  ElasticLoadBalancingV2Client,
  DescribeTargetGroupsCommand,
  DescribeTargetHealthCommand,
  DescribeLoadBalancersCommand,
  type LoadBalancer,
} from "@aws-sdk/client-elastic-load-balancing-v2";
import {
  CloudWatchClient,
  GetMetricStatisticsCommand,
} from "@aws-sdk/client-cloudwatch";
import {
  Recommendation,
  DependencyInfo,
  ScanError,
  RESOURCE_ACTION_MAP,
} from "@governance-engine/shared";
import { getClientForAccount } from "../credentials";

export interface SafeCleanupAdvisorInput {
  accountId: string;
  region: string;
  lookbackDays: number;
  crossAccountRoleArn?: string;
}

export interface SafeCleanupAdvisorOutput {
  recommendations: Recommendation[];
  resourcesEvaluated: number;
  errors: ScanError[];
}

export class SafeCleanupAdvisor {
  private scanId: string;

  constructor(scanId: string) {
    this.scanId = scanId;
  }

  async analyze(input: SafeCleanupAdvisorInput): Promise<SafeCleanupAdvisorOutput> {
      const recommendations: Recommendation[] = [];
      const errors: ScanError[] = [];
      let resourcesEvaluated = 0;

      const roleName = input.crossAccountRoleArn?.split("/").pop();

      const ec2 = await getClientForAccount(EC2Client, input.accountId, input.region, roleName);
      const elbv2 = await getClientForAccount(ElasticLoadBalancingV2Client, input.accountId, input.region, roleName);
      const cloudwatch = await getClientForAccount(CloudWatchClient, input.accountId, input.region, roleName);

      const detectors: Array<() => Promise<{ recs: Recommendation[]; evaluated: number }>> = [
        () => this.detectIdleEbsVolumes(ec2, cloudwatch, input),
        () => this.detectStoppedEc2Instances(ec2, input),
        () => this.detectUnassociatedElasticIps(ec2, input),
        () => this.detectIdleLoadBalancers(elbv2, cloudwatch, input),
        () => this.detectUnattachedSecurityGroups(ec2, input),
        () => this.detectIdleElastiCacheClusters(cloudwatch, input),
        () => this.detectIdleKinesisStreams(cloudwatch, input),
        () => this.detectUnusedEFSFileSystems(input),
        () => this.detectIdleAutoScalingGroups(input),
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

      // Check dependencies for each recommendation and set risk level accordingly
      for (const rec of recommendations) {
        try {
          await this.checkDependencies(ec2, rec);
        } catch {
          // Dependency check failure should not block the recommendation
        }
      }

      return { recommendations, resourcesEvaluated, errors };
    }


  private async detectIdleEbsVolumes(
    ec2: EC2Client,
    cloudwatch: CloudWatchClient,
    input: SafeCleanupAdvisorInput
  ): Promise<{ recs: Recommendation[]; evaluated: number }> {
    const recs: Recommendation[] = [];
    const now = new Date();
    const lookbackStart = new Date(now.getTime() - input.lookbackDays * 24 * 60 * 60 * 1000);

    const response = await ec2.send(
      new DescribeVolumesCommand({
        Filters: [{ Name: "status", Values: ["available"] }],
      })
    );

    const volumes = response.Volumes ?? [];

    for (const volume of volumes) {
      if (!volume.VolumeId) continue;

      const hasIO = await this.hasVolumeIO(cloudwatch, volume.VolumeId, lookbackStart, now);

      if (!hasIO) {
        recs.push(this.createRecommendation(input, {
          resourceId: volume.VolumeId,
          resourceType: "EBSVolume",
          issueDescription: `EBS volume ${volume.VolumeId} is unattached with zero read/write operations in the last ${input.lookbackDays} days`,
          suggestedAction: "Delete the unattached EBS volume to stop incurring storage charges",
          explanation: `This volume has been in 'available' (unattached) state and shows no I/O activity over the lookback period of ${input.lookbackDays} days. It is likely no longer needed.`,
          estimatedMonthlySavings: this.estimateEbsCost(volume),
        }));
      }
    }

    return { recs, evaluated: volumes.length };
  }

  private async hasVolumeIO(
    cloudwatch: CloudWatchClient,
    volumeId: string,
    start: Date,
    end: Date
  ): Promise<boolean> {
    const metrics = ["VolumeReadOps", "VolumeWriteOps"];

    for (const metricName of metrics) {
      const result = await cloudwatch.send(
        new GetMetricStatisticsCommand({
          Namespace: "AWS/EBS",
          MetricName: metricName,
          Dimensions: [{ Name: "VolumeId", Value: volumeId }],
          StartTime: start,
          EndTime: end,
          Period: 86400, // 1 day
          Statistics: ["Sum"],
        })
      );

      const totalOps = (result.Datapoints ?? []).reduce(
        (sum, dp) => sum + (dp.Sum ?? 0),
        0
      );

      if (totalOps > 0) return true;
    }

    return false;
  }

  /**
   * Estimate monthly EBS volume cost using approximate us-east-1 on-demand pricing.
   * These are standard published rates and rarely change. Actual costs may vary
   * by region, volume IOPS/throughput provisioning, and any discount programs.
   * The billing dashboard uses real Cost Explorer data for accurate totals.
   */
  private estimateEbsCost(volume: Volume): number | null {
    const sizeGb = volume.Size ?? 0;
    if (sizeGb === 0) return null;

    // Approximate us-east-1 on-demand pricing per GB-month (may differ by region)
    const pricePerGb: Record<string, number> = {
      gp2: 0.10,
      gp3: 0.08,
      io1: 0.125,
      io2: 0.125,
      st1: 0.045,
      sc1: 0.015,
      standard: 0.05,
    };

    const rate = pricePerGb[volume.VolumeType ?? "gp3"] ?? 0.08;
    return Math.round(sizeGb * rate * 100) / 100;
  }

  private async detectStoppedEc2Instances(
    ec2: EC2Client,
    input: SafeCleanupAdvisorInput
  ): Promise<{ recs: Recommendation[]; evaluated: number }> {
    const recs: Recommendation[] = [];
    const now = new Date();
    const lookbackThreshold = new Date(now.getTime() - input.lookbackDays * 24 * 60 * 60 * 1000);

    const response = await ec2.send(
      new DescribeInstancesCommand({
        Filters: [{ Name: "instance-state-name", Values: ["stopped"] }],
      })
    );

    const instances: Instance[] = [];
    for (const reservation of response.Reservations ?? []) {
      instances.push(...(reservation.Instances ?? []));
    }

    for (const instance of instances) {
      if (!instance.InstanceId) continue;

      const stateTransitionTime = instance.StateTransitionReason
        ? this.parseStateTransitionTime(instance.StateTransitionReason)
        : null;

      if (stateTransitionTime && stateTransitionTime < lookbackThreshold) {
        recs.push(this.createRecommendation(input, {
          resourceId: instance.InstanceId,
          resourceType: "EC2Instance",
          issueDescription: `EC2 instance ${instance.InstanceId} has been stopped since ${stateTransitionTime.toISOString()}`,
          suggestedAction: "Terminate the stopped instance if it is no longer needed, or create an AMI and terminate",
          explanation: `This instance has been in a stopped state for more than ${input.lookbackDays} days. Stopped instances still incur charges for attached EBS volumes.`,
          estimatedMonthlySavings: null,
        }));
      }
    }

    return { recs, evaluated: instances.length };
  }

  private parseStateTransitionTime(reason: string): Date | null {
    // AWS format: "User initiated (YYYY-MM-DD HH:MM:SS GMT)"
    const match = reason.match(/\((\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}:\d{2})\s+GMT\)/);
    if (match) {
      return new Date(match[1] + "Z");
    }
    return null;
  }

  private async detectUnassociatedElasticIps(
    ec2: EC2Client,
    input: SafeCleanupAdvisorInput
  ): Promise<{ recs: Recommendation[]; evaluated: number }> {
    const recs: Recommendation[] = [];

    const response = await ec2.send(new DescribeAddressesCommand({}));
    const addresses = response.Addresses ?? [];

    for (const address of addresses) {
      if (!address.AllocationId) continue;

      // An EIP is unassociated if it has no AssociationId
      if (!address.AssociationId) {
        recs.push(this.createRecommendation(input, {
          resourceId: address.AllocationId,
          resourceType: "ElasticIP",
          issueDescription: `Elastic IP ${address.PublicIp ?? address.AllocationId} is not associated with any running instance`,
          suggestedAction: "Release the Elastic IP if it is no longer needed to avoid hourly charges",
          explanation: `Unassociated Elastic IPs incur charges. This EIP is not attached to any instance or network interface.`,
          estimatedMonthlySavings: 3.60, // Approximate us-east-1 rate: ~$0.005/hr * 720 hrs/month
        }));
      }
    }

    return { recs, evaluated: addresses.length };
  }

  private async detectIdleLoadBalancers(
    elbv2: ElasticLoadBalancingV2Client,
    cloudwatch: CloudWatchClient,
    input: SafeCleanupAdvisorInput
  ): Promise<{ recs: Recommendation[]; evaluated: number }> {
    const recs: Recommendation[] = [];
    const now = new Date();
    const lookbackStart = new Date(now.getTime() - input.lookbackDays * 24 * 60 * 60 * 1000);

    const lbResponse = await elbv2.send(new DescribeLoadBalancersCommand({}));
    const loadBalancers = lbResponse.LoadBalancers ?? [];

    for (const lb of loadBalancers) {
      if (!lb.LoadBalancerArn) continue;

      // Get target groups for this load balancer
      const tgResponse = await elbv2.send(
        new DescribeTargetGroupsCommand({ LoadBalancerArn: lb.LoadBalancerArn })
      );
      const targetGroups = tgResponse.TargetGroups ?? [];

      let hasHealthyTargets = false;

      for (const tg of targetGroups) {
        if (!tg.TargetGroupArn) continue;

        const healthResponse = await elbv2.send(
          new DescribeTargetHealthCommand({ TargetGroupArn: tg.TargetGroupArn })
        );

        const healthyCount = (healthResponse.TargetHealthDescriptions ?? []).filter(
          (desc) => desc.TargetHealth?.State === "healthy"
        ).length;

        if (healthyCount > 0) {
          hasHealthyTargets = true;
          break;
        }
      }

      if (!hasHealthyTargets) {
        // Verify via CloudWatch that there have been zero healthy targets over the lookback period
        const arnSuffix = lb.LoadBalancerArn.split(":loadbalancer/").pop();
        const zeroHealthy = await this.hasZeroHealthyHostCount(
          cloudwatch,
          arnSuffix ?? "",
          lookbackStart,
          now
        );

        if (zeroHealthy) {
          recs.push(this.createRecommendation(input, {
            resourceId: lb.LoadBalancerArn,
            resourceType: "LoadBalancer",
            issueDescription: `Load balancer ${lb.LoadBalancerName ?? lb.LoadBalancerArn} has had zero healthy targets for the last ${input.lookbackDays} days`,
            suggestedAction: "Delete the load balancer if it is no longer serving traffic",
            explanation: `This load balancer has no healthy targets across all its target groups over the lookback period. It is likely not serving any traffic.`,
            estimatedMonthlySavings: this.estimateAlbCost(lb),
          }));
        }
      }
    }

    return { recs, evaluated: loadBalancers.length };
  }

  private async hasZeroHealthyHostCount(
    cloudwatch: CloudWatchClient,
    lbArnSuffix: string,
    start: Date,
    end: Date
  ): Promise<boolean> {
    const result = await cloudwatch.send(
      new GetMetricStatisticsCommand({
        Namespace: "AWS/ApplicationELB",
        MetricName: "HealthyHostCount",
        Dimensions: [{ Name: "LoadBalancer", Value: lbArnSuffix }],
        StartTime: start,
        EndTime: end,
        Period: 86400,
        Statistics: ["Maximum"],
      })
    );

    const maxHealthy = (result.Datapoints ?? []).reduce(
      (max, dp) => Math.max(max, dp.Maximum ?? 0),
      0
    );

    return maxHealthy === 0;
  }

  /**
   * Estimate monthly ALB cost using approximate us-east-1 on-demand pricing.
   * Only includes base hourly charge (~$0.0225/hr); LCU charges vary by traffic.
   */
  private estimateAlbCost(lb: LoadBalancer): number | null {
    // Approximate us-east-1 ALB base cost: $0.0225/hr * 720 hrs = ~$16.20/month
    return 16.20;
  }

  private async detectUnattachedSecurityGroups(
    ec2: EC2Client,
    input: SafeCleanupAdvisorInput
  ): Promise<{ recs: Recommendation[]; evaluated: number }> {
    const recs: Recommendation[] = [];

    const sgResponse = await ec2.send(new DescribeSecurityGroupsCommand({}));
    const securityGroups = sgResponse.SecurityGroups ?? [];

    for (const sg of securityGroups) {
      if (!sg.GroupId) continue;

      // Skip the default security group — it cannot be deleted
      if (sg.GroupName === "default") continue;

      const eniResponse = await ec2.send(
        new DescribeNetworkInterfacesCommand({
          Filters: [{ Name: "group-id", Values: [sg.GroupId] }],
        })
      );

      const attachedInterfaces = eniResponse.NetworkInterfaces ?? [];

      if (attachedInterfaces.length === 0) {
        recs.push(this.createRecommendation(input, {
          resourceId: sg.GroupId,
          resourceType: "SecurityGroup",
          issueDescription: `Security group ${sg.GroupName ?? sg.GroupId} (${sg.GroupId}) is not attached to any network interface`,
          suggestedAction: "Delete the unused security group to reduce clutter and potential misconfiguration risk",
          explanation: `This security group is not associated with any ENI. Unused security groups add complexity and may pose a risk if accidentally attached to resources.`,
          estimatedMonthlySavings: null, // Security groups have no direct cost
        }));
      }
    }

    return { recs, evaluated: securityGroups.length };
  }

  // ═══════════════════════════════════════════
  // NEW SERVICE DETECTORS
  // ═══════════════════════════════════════════

  private async detectIdleElastiCacheClusters(
    cloudwatch: CloudWatchClient, input: SafeCleanupAdvisorInput
  ): Promise<{ recs: Recommendation[]; evaluated: number }> {
    const recs: Recommendation[] = [];
    const now = new Date();
    const lookbackStart = new Date(now.getTime() - input.lookbackDays * 24 * 60 * 60 * 1000);
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
      if (!cluster.CacheClusterId || cluster.CacheClusterStatus !== "available") continue;
      const result = await cloudwatch.send(new GetMetricStatisticsCommand({
        Namespace: "AWS/ElastiCache", MetricName: "CurrConnections",
        Dimensions: [{ Name: "CacheClusterId", Value: cluster.CacheClusterId }],
        StartTime: lookbackStart, EndTime: now, Period: 86400, Statistics: ["Maximum"],
      }));
      const maxConns = (result.Datapoints ?? []).reduce((max, dp) => Math.max(max, dp.Maximum ?? 0), 0);
      if (maxConns === 0) {
        const hourly = CACHE_HOURLY[cluster.CacheNodeType ?? ""] ?? 0;
        recs.push(this.createRecommendation(input, {
          resourceId: cluster.ARN ?? cluster.CacheClusterId, resourceType: "ElastiCacheCluster",
          issueDescription: `ElastiCache cluster "${cluster.CacheClusterId}" has zero connections in the last ${input.lookbackDays} days`,
          suggestedAction: "Delete the cluster if it is no longer needed",
          explanation: `This cluster has had no client connections during the lookback period.`,
          estimatedMonthlySavings: Math.round(hourly * 730 * 100) / 100,
        }));
      }
    }
    return { recs, evaluated: clusters.length };
  }

  private async detectIdleKinesisStreams(
    cloudwatch: CloudWatchClient, input: SafeCleanupAdvisorInput
  ): Promise<{ recs: Recommendation[]; evaluated: number }> {
    const recs: Recommendation[] = [];
    const now = new Date();
    const lookbackStart = new Date(now.getTime() - input.lookbackDays * 24 * 60 * 60 * 1000);
    const { KinesisClient, ListStreamsCommand, DescribeStreamSummaryCommand } = await import("@aws-sdk/client-kinesis");
    const roleName = input.crossAccountRoleArn?.split("/").pop();
    const client = await getClientForAccount(KinesisClient, input.accountId, input.region, roleName);
    const res = await client.send(new ListStreamsCommand({}));
    const streamNames = res.StreamNames ?? [];
    for (const streamName of streamNames) {
      try {
        const desc = await client.send(new DescribeStreamSummaryCommand({ StreamName: streamName }));
        const shardCount = desc.StreamDescriptionSummary?.OpenShardCount ?? 1;
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
            suggestedAction: "Delete the stream to save on shard-hour charges",
            explanation: `This stream has received no data during the lookback period.`,
            estimatedMonthlySavings: Math.round(shardCount * 0.015 * 730 * 100) / 100, // Approximate us-east-1 shard-hour rate
          }));
        }
      } catch { /* skip */ }
    }
    return { recs, evaluated: streamNames.length };
  }

  private async detectUnusedEFSFileSystems(input: SafeCleanupAdvisorInput): Promise<{ recs: Recommendation[]; evaluated: number }> {
    const recs: Recommendation[] = [];
    const { EFSClient, DescribeFileSystemsCommand } = await import("@aws-sdk/client-efs");
    const roleName = input.crossAccountRoleArn?.split("/").pop();
    const client = await getClientForAccount(EFSClient, input.accountId, input.region, roleName);
    const res = await client.send(new DescribeFileSystemsCommand({}));
    const fileSystems = res.FileSystems ?? [];
    for (const fs of fileSystems) {
      if (!fs.FileSystemId) continue;
      if (fs.NumberOfMountTargets === 0) {
        const sizeGb = (fs.SizeInBytes?.Value ?? 0) / (1024 * 1024 * 1024);
        recs.push(this.createRecommendation(input, {
          resourceId: fs.FileSystemId, resourceType: "EFSFileSystem",
          issueDescription: `EFS file system "${fs.Name ?? fs.FileSystemId}" has no mount targets`,
          suggestedAction: "Delete the file system if it is no longer needed",
          explanation: `This file system has no mount targets and cannot be accessed.`,
          estimatedMonthlySavings: Math.round(sizeGb * 0.30 * 100) / 100, // Approximate us-east-1 EFS Standard rate
        }));
      }
    }
    return { recs, evaluated: fileSystems.length };
  }

  private async detectIdleAutoScalingGroups(input: SafeCleanupAdvisorInput): Promise<{ recs: Recommendation[]; evaluated: number }> {
    const recs: Recommendation[] = [];
    const { AutoScalingClient, DescribeAutoScalingGroupsCommand } = await import("@aws-sdk/client-auto-scaling");
    const roleName = input.crossAccountRoleArn?.split("/").pop();
    const client = await getClientForAccount(AutoScalingClient, input.accountId, input.region, roleName);
    const res = await client.send(new DescribeAutoScalingGroupsCommand({}));
    const groups = res.AutoScalingGroups ?? [];
    for (const asg of groups) {
      if (!asg.AutoScalingGroupName) continue;
      if ((asg.DesiredCapacity ?? 0) === 0 && (asg.Instances ?? []).length === 0) {
        recs.push(this.createRecommendation(input, {
          resourceId: asg.AutoScalingGroupARN ?? asg.AutoScalingGroupName, resourceType: "AutoScalingGroup",
          issueDescription: `Auto Scaling group "${asg.AutoScalingGroupName}" has zero desired capacity and no running instances`,
          suggestedAction: "Delete the Auto Scaling group if it is no longer needed",
          explanation: `This ASG has no instances and a desired capacity of zero.`,
          estimatedMonthlySavings: 0,
        }));
      }
    }
    return { recs, evaluated: groups.length };
  }

  private async checkDependencies(ec2: EC2Client, recommendation: Recommendation): Promise<void> {
    const dependencies: DependencyInfo[] = [];

    switch (recommendation.resourceType) {
      case "EBSVolume":
        await this.checkEbsVolumeDependencies(ec2, recommendation.resourceId, dependencies);
        break;
      case "EC2Instance":
        await this.checkEc2InstanceDependencies(ec2, recommendation.resourceId, dependencies);
        break;
      case "SecurityGroup":
        await this.checkSecurityGroupDependencies(ec2, recommendation.resourceId, dependencies);
        break;
      case "ElasticIP":
        // No additional dependency checks needed for Elastic IPs
        break;
      case "LoadBalancer":
        // Simplified: target groups are already checked during detection
        break;
    }

    recommendation.dependencies = dependencies;
    if (dependencies.length > 0) {
      recommendation.riskLevel = "High";
    } else {
      recommendation.riskLevel = "Low";
    }
  }

  private async checkEbsVolumeDependencies(
    ec2: EC2Client,
    volumeId: string,
    dependencies: DependencyInfo[]
  ): Promise<void> {
    const response = await ec2.send(
      new DescribeSnapshotsCommand({
        Filters: [{ Name: "volume-id", Values: [volumeId] }],
        OwnerIds: ["self"],
      })
    );

    for (const snapshot of response.Snapshots ?? []) {
      if (snapshot.SnapshotId) {
        dependencies.push({
          resourceId: snapshot.SnapshotId,
          resourceType: "EBSSnapshot",
          relationship: "snapshot references volume",
        });
      }
    }
  }

  private async checkEc2InstanceDependencies(
    ec2: EC2Client,
    instanceId: string,
    dependencies: DependencyInfo[]
  ): Promise<void> {
    const response = await ec2.send(
      new DescribeImagesCommand({
        Filters: [{ Name: "name", Values: [`*${instanceId}*`] }],
        Owners: ["self"],
      })
    );

    for (const image of response.Images ?? []) {
      if (image.ImageId) {
        dependencies.push({
          resourceId: image.ImageId,
          resourceType: "AMI",
          relationship: "AMI created from instance",
        });
      }
    }
  }

  private async checkSecurityGroupDependencies(
    ec2: EC2Client,
    securityGroupId: string,
    dependencies: DependencyInfo[]
  ): Promise<void> {
    // Check for other security groups that reference this one in their rules
    const sgResponse = await ec2.send(
      new DescribeSecurityGroupsCommand({
        Filters: [
          { Name: "ip-permission.group-id", Values: [securityGroupId] },
        ],
      })
    );

    for (const sg of sgResponse.SecurityGroups ?? []) {
      if (sg.GroupId && sg.GroupId !== securityGroupId) {
        dependencies.push({
          resourceId: sg.GroupId,
          resourceType: "SecurityGroup",
          relationship: "security group references this group in its rules",
        });
      }
    }

    // Check for launch templates referencing this security group
    try {
      const ltResponse = await ec2.send(
        new DescribeLaunchTemplateVersionsCommand({
          Versions: ["$Latest"],
          Filters: [
            { Name: "launch-template-name", Values: ["*"] },
          ],
        })
      );

      for (const version of ltResponse.LaunchTemplateVersions ?? []) {
        const sgIds = version.LaunchTemplateData?.SecurityGroupIds ?? [];
        const sgNames = version.LaunchTemplateData?.SecurityGroups ?? [];
        if (sgIds.includes(securityGroupId) || sgNames.includes(securityGroupId)) {
          dependencies.push({
            resourceId: version.LaunchTemplateId ?? version.LaunchTemplateName ?? "unknown",
            resourceType: "LaunchTemplate",
            relationship: "launch template references this security group",
          });
        }
      }
    } catch {
      // Launch template check is best-effort; continue if it fails
    }
  }

  private createRecommendation(
    input: SafeCleanupAdvisorInput,
    fields: {
      resourceId: string;
      resourceType: keyof typeof RESOURCE_ACTION_MAP;
      issueDescription: string;
      suggestedAction: string;
      explanation: string;
      estimatedMonthlySavings: number | null;
    }
  ): Recommendation {
    return {
      recommendationId: crypto.randomUUID(),
      scanId: this.scanId,
      accountId: input.accountId,
      region: input.region,
      advisorType: "SafeCleanupAdvisor",
      resourceId: fields.resourceId,
      resourceType: fields.resourceType,
      issueDescription: fields.issueDescription,
      suggestedAction: fields.suggestedAction,
      riskLevel: "Low", // Default to Low; dependency checking (Task 3.2) will upgrade to High
      explanation: fields.explanation,
      estimatedMonthlySavings: fields.estimatedMonthlySavings,
      dependencies: [], // Populated by dependency checking (Task 3.2)
      availableActions: RESOURCE_ACTION_MAP[fields.resourceType],
      createdAt: new Date().toISOString(),
    };
  }
}

// Lambda handler for CDK integration
export async function handler(event: SafeCleanupAdvisorInput & { scanId: string }): Promise<SafeCleanupAdvisorOutput> {
  const advisor = new SafeCleanupAdvisor(event.scanId);
  return advisor.analyze(event);
}
