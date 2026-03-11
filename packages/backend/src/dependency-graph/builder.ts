import {
  EC2Client,
  DescribeInstancesCommand,
  DescribeSecurityGroupsCommand,
  DescribeSubnetsCommand,
  DescribeVolumesCommand,
  DescribeAddressesCommand,
} from "@aws-sdk/client-ec2";
import {
  LambdaClient,
  ListFunctionsCommand,
  ListEventSourceMappingsCommand,
} from "@aws-sdk/client-lambda";
import {
  ECSClient,
  ListClustersCommand,
  ListServicesCommand,
  DescribeServicesCommand,
} from "@aws-sdk/client-ecs";
import {
  RDSClient,
  DescribeDBInstancesCommand,
} from "@aws-sdk/client-rds";
import {
  ElasticLoadBalancingV2Client,
  DescribeLoadBalancersCommand,
  DescribeTargetGroupsCommand,
} from "@aws-sdk/client-elastic-load-balancing-v2";
import {
  S3Client,
  ListBucketsCommand,
  GetBucketNotificationConfigurationCommand,
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
  ResourceNode,
  DependencyEdge,
  GraphDiscoveryError,
  GraphResourceType,
} from "@governance-engine/shared";
import { getClientForAccount } from "../credentials";

export interface DiscoverInput {
  scanId: string;
  accountId: string;
  region: string;
  crossAccountRoleArn?: string;
}

export interface DiscoverOutput {
  nodes: ResourceNode[];
  edges: DependencyEdge[];
  errors: GraphDiscoveryError[];
}

export class DependencyGraphBuilder {
  private nodes: Map<string, ResourceNode> = new Map();
  private edges: DependencyEdge[] = [];
  private accountId = "";
  private region = "";

  async discover(input: DiscoverInput): Promise<DiscoverOutput> {
    this.nodes = new Map();
    this.edges = [];
    this.accountId = input.accountId;
    this.region = input.region;
    const errors: GraphDiscoveryError[] = [];

    const roleName = input.crossAccountRoleArn?.split("/").pop();
    const ec2Client = await getClientForAccount(
      EC2Client,
      input.accountId,
      input.region,
      roleName
    );

    try {
      await this.discoverEC2Dependencies(ec2Client);
    } catch (err: unknown) {
      const error = err as Error & { name?: string; Code?: string };
      errors.push({
        resourceType: "EC2Instance",
        errorCode: error.name ?? "UnknownError",
        errorMessage: error.message ?? "Unknown error during EC2 discovery",
      });
    }

    try {
      const lambdaClient = await getClientForAccount(
        LambdaClient,
        input.accountId,
        input.region,
        roleName
      );
      await this.discoverLambdaDependencies(lambdaClient);
    } catch (err: unknown) {
      const error = err as Error & { name?: string; Code?: string };
      errors.push({
        resourceType: "LambdaFunction",
        errorCode: error.name ?? "UnknownError",
        errorMessage: error.message ?? "Unknown error during Lambda discovery",
      });
    }

    try {
      const ecsClient = await getClientForAccount(
        ECSClient,
        input.accountId,
        input.region,
        roleName
      );
      await this.discoverECSDependencies(ecsClient);
    } catch (err: unknown) {
      const error = err as Error & { name?: string; Code?: string };
      errors.push({
        resourceType: "ECSService",
        errorCode: error.name ?? "UnknownError",
        errorMessage: error.message ?? "Unknown error during ECS discovery",
      });
    }

    try {
      const rdsClient = await getClientForAccount(
        RDSClient,
        input.accountId,
        input.region,
        roleName
      );
      await this.discoverRDSDependencies(rdsClient);
    } catch (err: unknown) {
      const error = err as Error & { name?: string; Code?: string };
      errors.push({
        resourceType: "RDSInstance",
        errorCode: error.name ?? "UnknownError",
        errorMessage: error.message ?? "Unknown error during RDS discovery",
      });
    }

    try {
      const elbClient = await getClientForAccount(
        ElasticLoadBalancingV2Client,
        input.accountId,
        input.region,
        roleName
      );
      await this.discoverLoadBalancerDependencies(elbClient);
    } catch (err: unknown) {
      const error = err as Error & { name?: string; Code?: string };
      errors.push({
        resourceType: "LoadBalancer",
        errorCode: error.name ?? "UnknownError",
        errorMessage:
          error.message ?? "Unknown error during Load Balancer discovery",
      });
    }

    // S3 Buckets
    try {
      const s3Client = await getClientForAccount(S3Client, input.accountId, input.region, roleName);
      await this.discoverS3Dependencies(s3Client);
    } catch (err: unknown) {
      const error = err as Error & { name?: string };
      errors.push({ resourceType: "S3Bucket", errorCode: error.name ?? "UnknownError", errorMessage: error.message ?? "Unknown error during S3 discovery" });
    }

    // DynamoDB Tables
    try {
      const dynamoClient = await getClientForAccount(DynamoDBClient, input.accountId, input.region, roleName);
      await this.discoverDynamoDBDependencies(dynamoClient);
    } catch (err: unknown) {
      const error = err as Error & { name?: string };
      errors.push({ resourceType: "DynamoDBTable", errorCode: error.name ?? "UnknownError", errorMessage: error.message ?? "Unknown error during DynamoDB discovery" });
    }

    // SNS Topics
    try {
      const snsClient = await getClientForAccount(SNSClient, input.accountId, input.region, roleName);
      await this.discoverSNSDependencies(snsClient);
    } catch (err: unknown) {
      const error = err as Error & { name?: string };
      errors.push({ resourceType: "SNSTopic", errorCode: error.name ?? "UnknownError", errorMessage: error.message ?? "Unknown error during SNS discovery" });
    }

    // SQS Queues
    try {
      const sqsClient = await getClientForAccount(SQSClient, input.accountId, input.region, roleName);
      await this.discoverSQSDependencies(sqsClient);
    } catch (err: unknown) {
      const error = err as Error & { name?: string };
      errors.push({ resourceType: "SQSQueue", errorCode: error.name ?? "UnknownError", errorMessage: error.message ?? "Unknown error during SQS discovery" });
    }

    // CloudFront Distributions
    try {
      await this.discoverCloudFrontDependencies(input.accountId, roleName);
    } catch (err: unknown) {
      const error = err as Error & { name?: string };
      errors.push({ resourceType: "CloudFrontDistribution", errorCode: error.name ?? "UnknownError", errorMessage: error.message ?? "Unknown error during CloudFront discovery" });
    }

    // API Gateway
    try {
      await this.discoverAPIGatewayDependencies(input.accountId, input.region, roleName);
    } catch (err: unknown) {
      const error = err as Error & { name?: string };
      errors.push({ resourceType: "APIGatewayRestAPI", errorCode: error.name ?? "UnknownError", errorMessage: error.message ?? "Unknown error during API Gateway discovery" });
    }

    return {
      nodes: Array.from(this.nodes.values()),
      edges: this.edges,
      errors,
    };
  }

  private async discoverEC2Dependencies(ec2Client: EC2Client): Promise<void> {
    // 1. Discover all EC2 instances
    const instancesResponse = await ec2Client.send(
      new DescribeInstancesCommand({})
    );

    const securityGroupIds = new Set<string>();
    const subnetIds = new Set<string>();
    const instanceIds: string[] = [];

    for (const reservation of instancesResponse.Reservations ?? []) {
      for (const instance of reservation.Instances ?? []) {
        if (!instance.InstanceId) continue;

        const displayName = this.getNameTag(instance.Tags) ?? instance.InstanceId;
        this.addNode(instance.InstanceId, "EC2Instance", displayName);
        instanceIds.push(instance.InstanceId);

        // EC2 → SecurityGroup edges
        for (const sg of instance.SecurityGroups ?? []) {
          if (sg.GroupId) {
            securityGroupIds.add(sg.GroupId);
            this.addEdge(instance.InstanceId, sg.GroupId, "uses security group");
          }
        }

        // EC2 → Subnet edge
        if (instance.SubnetId) {
          subnetIds.add(instance.SubnetId);
          this.addEdge(instance.InstanceId, instance.SubnetId, "launched in");
        }

        // EC2 → IAMRole edge (instance profile)
        if (instance.IamInstanceProfile?.Arn) {
          const roleName = this.extractRoleNameFromInstanceProfile(
            instance.IamInstanceProfile.Arn
          );
          if (roleName) {
            this.addNode(roleName, "IAMRole", roleName);
            this.addEdge(instance.InstanceId, roleName, "uses instance profile");
          }
        }
      }
    }

    // 2. Discover EBS volumes attached to instances
    if (instanceIds.length > 0) {
      const volumesResponse = await ec2Client.send(
        new DescribeVolumesCommand({
          Filters: [
            { Name: "attachment.instance-id", Values: instanceIds },
          ],
        })
      );

      for (const volume of volumesResponse.Volumes ?? []) {
        if (!volume.VolumeId) continue;

        const volumeDisplayName = this.getNameTag(volume.Tags) ?? volume.VolumeId;
        this.addNode(volume.VolumeId, "EBSVolume", volumeDisplayName);

        for (const attachment of volume.Attachments ?? []) {
          if (attachment.InstanceId) {
            this.addEdge(attachment.InstanceId, volume.VolumeId, "attached to");
          }
        }
      }
    }

    // 3. Discover Elastic IPs associated with instances
    const addressesResponse = await ec2Client.send(
      new DescribeAddressesCommand({})
    );

    for (const address of addressesResponse.Addresses ?? []) {
      if (!address.AllocationId || !address.InstanceId) continue;
      // Only include EIPs associated with discovered instances
      if (!this.nodes.has(address.InstanceId)) continue;

      const eipDisplayName =
        this.getNameTag(address.Tags) ??
        address.PublicIp ??
        address.AllocationId;
      this.addNode(address.AllocationId, "ElasticIP", eipDisplayName);
      this.addEdge(address.InstanceId, address.AllocationId, "associated with");
    }

    // 4. Discover SecurityGroup → VPC relationships
    if (securityGroupIds.size > 0) {
      const sgResponse = await ec2Client.send(
        new DescribeSecurityGroupsCommand({
          GroupIds: Array.from(securityGroupIds),
        })
      );

      for (const sg of sgResponse.SecurityGroups ?? []) {
        if (!sg.GroupId) continue;

        const sgDisplayName =
          this.getNameTag(sg.Tags) ?? sg.GroupName ?? sg.GroupId;
        this.addNode(sg.GroupId, "SecurityGroup", sgDisplayName);

        if (sg.VpcId) {
          this.addNode(sg.VpcId, "VPC", sg.VpcId);
          this.addEdge(sg.GroupId, sg.VpcId, "member of");
        }
      }
    }

    // 5. Discover Subnet → VPC relationships
    if (subnetIds.size > 0) {
      const subnetResponse = await ec2Client.send(
        new DescribeSubnetsCommand({
          SubnetIds: Array.from(subnetIds),
        })
      );

      for (const subnet of subnetResponse.Subnets ?? []) {
        if (!subnet.SubnetId) continue;

        const subnetDisplayName =
          this.getNameTag(subnet.Tags) ?? subnet.SubnetId;
        this.addNode(subnet.SubnetId, "Subnet", subnetDisplayName);

        if (subnet.VpcId) {
          this.addNode(subnet.VpcId, "VPC", subnet.VpcId);
          this.addEdge(subnet.SubnetId, subnet.VpcId, "member of");
        }
      }
    }
  }

  private async discoverLambdaDependencies(
    lambdaClient: LambdaClient
  ): Promise<void> {
    let marker: string | undefined;
    const functions: Array<{
      FunctionName?: string;
      FunctionArn?: string;
      Role?: string;
      VpcConfig?: {
        SubnetIds?: string[];
        SecurityGroupIds?: string[];
      };
    }> = [];

    do {
      const response = await lambdaClient.send(
        new ListFunctionsCommand({ Marker: marker })
      );
      for (const fn of response.Functions ?? []) {
        functions.push(fn);
      }
      marker = response.NextMarker;
    } while (marker);

    for (const fn of functions) {
      if (!fn.FunctionName) continue;

      const functionId = fn.FunctionArn ?? fn.FunctionName;
      this.addNode(functionId, "LambdaFunction", fn.FunctionName);

      // Lambda → IAMRole
      if (fn.Role) {
        const roleName = fn.Role.split("/").pop();
        if (roleName) {
          this.addNode(roleName, "IAMRole", roleName);
          this.addEdge(functionId, roleName, "executes as");
        }
      }

      // Lambda → Subnet
      for (const subnetId of fn.VpcConfig?.SubnetIds ?? []) {
        this.addNode(subnetId, "Subnet", subnetId);
        this.addEdge(functionId, subnetId, "connected to");
      }

      // Lambda → SecurityGroup
      for (const sgId of fn.VpcConfig?.SecurityGroupIds ?? []) {
        this.addNode(sgId, "SecurityGroup", sgId);
        this.addEdge(functionId, sgId, "uses security group");
      }

      // Discover event source mappings (SQS → Lambda, DynamoDB → Lambda, etc.)
      try {
        const esm = await lambdaClient.send(new ListEventSourceMappingsCommand({ FunctionName: fn.FunctionName }));
        for (const mapping of esm.EventSourceMappings ?? []) {
          if (!mapping.EventSourceArn) continue;
          const sourceArn = mapping.EventSourceArn;
          if (sourceArn.includes(":sqs:")) {
            const queueName = sourceArn.split(":").pop() ?? sourceArn;
            this.addNode(sourceArn, "SQSQueue", queueName);
            this.addEdge(sourceArn, functionId, "triggers");
          } else if (sourceArn.includes(":dynamodb:") && sourceArn.includes("/stream/")) {
            // DynamoDB stream → Lambda; link to the table
            const tablePart = sourceArn.split("/stream/")[0];
            const tableName = tablePart.split("/").pop() ?? tablePart;
            this.addEdge(tableName, functionId, "stream triggers");
          } else if (sourceArn.includes(":kinesis:")) {
            const streamName = sourceArn.split("/").pop() ?? sourceArn;
            this.addNode(sourceArn, "KinesisStream", streamName);
            this.addEdge(sourceArn, functionId, "triggers");
          }
        }
      } catch { /* skip event source mapping discovery */ }
    }
  }

  private async discoverECSDependencies(
    ecsClient: ECSClient
  ): Promise<void> {
    // 1. List all clusters
    const clusterArns: string[] = [];
    let nextToken: string | undefined;

    do {
      const response = await ecsClient.send(
        new ListClustersCommand({ nextToken })
      );
      for (const arn of response.clusterArns ?? []) {
        clusterArns.push(arn);
      }
      nextToken = response.nextToken;
    } while (nextToken);

    // 2. For each cluster, list and describe services
    for (const clusterArn of clusterArns) {
      const clusterName = clusterArn.split("/").pop() ?? clusterArn;
      this.addNode(clusterArn, "ECSCluster", clusterName);

      const serviceArns: string[] = [];
      let svcToken: string | undefined;

      do {
        const response = await ecsClient.send(
          new ListServicesCommand({ cluster: clusterArn, nextToken: svcToken })
        );
        for (const arn of response.serviceArns ?? []) {
          serviceArns.push(arn);
        }
        svcToken = response.nextToken;
      } while (svcToken);

      if (serviceArns.length === 0) continue;

      // DescribeServices accepts max 10 at a time
      for (let i = 0; i < serviceArns.length; i += 10) {
        const batch = serviceArns.slice(i, i + 10);
        const describeResponse = await ecsClient.send(
          new DescribeServicesCommand({
            cluster: clusterArn,
            services: batch,
          })
        );

        for (const service of describeResponse.services ?? []) {
          if (!service.serviceArn) continue;

          const serviceName = service.serviceName ?? service.serviceArn;
          this.addNode(service.serviceArn, "ECSService", serviceName);

          // ECSService → ECSCluster
          this.addEdge(service.serviceArn, clusterArn, "runs in");

          // ECSService → IAMRole (task role)
          if (service.roleArn) {
            const roleName = service.roleArn.split("/").pop();
            if (roleName) {
              this.addNode(roleName, "IAMRole", roleName);
              this.addEdge(service.serviceArn, roleName, "uses task role");
            }
          }

          // ECSService → LoadBalancer
          for (const lb of service.loadBalancers ?? []) {
            if (lb.loadBalancerName) {
              this.addNode(
                lb.loadBalancerName,
                "LoadBalancer",
                lb.loadBalancerName
              );
              this.addEdge(
                service.serviceArn,
                lb.loadBalancerName,
                "registered with"
              );
            }
          }
        }
      }
    }
  }

  private async discoverRDSDependencies(
    rdsClient: RDSClient
  ): Promise<void> {
    let marker: string | undefined;

    do {
      const response = await rdsClient.send(
        new DescribeDBInstancesCommand({ Marker: marker })
      );

      for (const instance of response.DBInstances ?? []) {
        if (!instance.DBInstanceIdentifier) continue;

        const instanceId =
          instance.DBInstanceArn ?? instance.DBInstanceIdentifier;
        this.addNode(
          instanceId,
          "RDSInstance",
          instance.DBInstanceIdentifier
        );

        // RDSInstance → SecurityGroup
        for (const sg of instance.VpcSecurityGroups ?? []) {
          if (sg.VpcSecurityGroupId) {
            this.addNode(
              sg.VpcSecurityGroupId,
              "SecurityGroup",
              sg.VpcSecurityGroupId
            );
            this.addEdge(
              instanceId,
              sg.VpcSecurityGroupId,
              "uses security group"
            );
          }
        }

        // RDSInstance → SubnetGroup
        if (instance.DBSubnetGroup?.DBSubnetGroupName) {
          const subnetGroupName = instance.DBSubnetGroup.DBSubnetGroupName;
          this.addNode(subnetGroupName, "SubnetGroup", subnetGroupName);
          this.addEdge(instanceId, subnetGroupName, "deployed in");
        }

        // RDSInstance → IAMRole (monitoring role)
        if (instance.MonitoringRoleArn) {
          const roleName = instance.MonitoringRoleArn.split("/").pop();
          if (roleName) {
            this.addNode(roleName, "IAMRole", roleName);
            this.addEdge(instanceId, roleName, "uses role");
          }
        }
      }

      marker = response.Marker;
    } while (marker);
  }

  private async discoverLoadBalancerDependencies(
    elbClient: ElasticLoadBalancingV2Client
  ): Promise<void> {
    let marker: string | undefined;
    const loadBalancerArns: string[] = [];

    do {
      const response = await elbClient.send(
        new DescribeLoadBalancersCommand({ Marker: marker })
      );

      for (const lb of response.LoadBalancers ?? []) {
        if (!lb.LoadBalancerArn) continue;

        const displayName = lb.LoadBalancerName ?? lb.LoadBalancerArn;
        this.addNode(lb.LoadBalancerArn, "LoadBalancer", displayName);
        loadBalancerArns.push(lb.LoadBalancerArn);

        // LoadBalancer → SecurityGroup
        for (const sgId of lb.SecurityGroups ?? []) {
          this.addNode(sgId, "SecurityGroup", sgId);
          this.addEdge(lb.LoadBalancerArn, sgId, "uses security group");
        }

        // LoadBalancer → Subnet (from AvailabilityZones)
        for (const az of lb.AvailabilityZones ?? []) {
          if (az.SubnetId) {
            this.addNode(az.SubnetId, "Subnet", az.SubnetId);
            this.addEdge(lb.LoadBalancerArn, az.SubnetId, "deployed in");
          }
        }
      }

      marker = response.NextMarker;
    } while (marker);

    // Discover target groups for each load balancer
    for (const lbArn of loadBalancerArns) {
      let tgMarker: string | undefined;

      do {
        const tgResponse = await elbClient.send(
          new DescribeTargetGroupsCommand({
            LoadBalancerArn: lbArn,
            Marker: tgMarker,
          })
        );

        for (const tg of tgResponse.TargetGroups ?? []) {
          if (!tg.TargetGroupArn) continue;

          const tgName = tg.TargetGroupName ?? tg.TargetGroupArn;
          this.addNode(tg.TargetGroupArn, "TargetGroup", tgName);
          this.addEdge(lbArn, tg.TargetGroupArn, "routes to");
        }

        tgMarker = tgResponse.NextMarker;
      } while (tgMarker);
    }
  }



  private async discoverS3Dependencies(s3Client: S3Client): Promise<void> {
    const res = await s3Client.send(new ListBucketsCommand({}));
    for (const bucket of res.Buckets ?? []) {
      if (!bucket.Name) continue;
      this.addNode(bucket.Name, "S3Bucket", bucket.Name);
      // Discover event notification targets (Lambda, SNS, SQS)
      try {
        const notif = await s3Client.send(new GetBucketNotificationConfigurationCommand({ Bucket: bucket.Name }));
        for (const lc of notif.LambdaFunctionConfigurations ?? []) {
          if (lc.LambdaFunctionArn) {
            this.addEdge(bucket.Name, lc.LambdaFunctionArn, "triggers");
          }
        }
        for (const tc of notif.TopicConfigurations ?? []) {
          if (tc.TopicArn) {
            this.addEdge(bucket.Name, tc.TopicArn, "notifies");
          }
        }
        for (const qc of notif.QueueConfigurations ?? []) {
          if (qc.QueueArn) {
            this.addEdge(bucket.Name, qc.QueueArn, "sends events to");
          }
        }
      } catch { /* bucket may not allow notification read */ }
    }
  }

  private async discoverDynamoDBDependencies(dynamoClient: DynamoDBClient): Promise<void> {
    const res = await dynamoClient.send(new ListTablesCommand({}));
    for (const tableName of res.TableNames ?? []) {
      this.addNode(tableName, "DynamoDBTable", tableName);
      // Check for streams and linked Lambda triggers
      try {
        const desc = await dynamoClient.send(new DescribeTableCommand({ TableName: tableName }));
        const table = desc.Table;
        if (table?.StreamSpecification?.StreamEnabled && table.LatestStreamArn) {
          // DynamoDB streams are typically consumed by Lambda event source mappings
          // We can't discover those from DynamoDB side, but we note the stream exists
          // The Lambda discovery already links Lambda → IAMRole; we link table to its stream consumers later
        }
        // Link to KMS key if SSE is enabled with a custom key
        if (table?.SSEDescription?.KMSMasterKeyArn) {
          const keyId = table.SSEDescription.KMSMasterKeyArn.split("/").pop() ?? table.SSEDescription.KMSMasterKeyArn;
          this.addNode(keyId, "KMSKey", keyId);
          this.addEdge(tableName, keyId, "encrypted by");
        }
      } catch { /* skip */ }
    }
  }

  private async discoverSNSDependencies(snsClient: SNSClient): Promise<void> {
    const res = await snsClient.send(new ListTopicsCommand({}));
    for (const topic of res.Topics ?? []) {
      if (!topic.TopicArn) continue;
      const topicName = topic.TopicArn.split(":").pop() ?? topic.TopicArn;
      this.addNode(topic.TopicArn, "SNSTopic", topicName);
      // Discover subscriptions that link to SQS/Lambda
      try {
        const subs = await snsClient.send(new ListSubscriptionsByTopicCommand({ TopicArn: topic.TopicArn }));
        for (const sub of subs.Subscriptions ?? []) {
          if (sub.Protocol === "sqs" && sub.Endpoint) {
            this.addNode(sub.Endpoint, "SQSQueue", sub.Endpoint.split(":").pop() ?? sub.Endpoint);
            this.addEdge(topic.TopicArn, sub.Endpoint, "delivers to");
          }
          if (sub.Protocol === "lambda" && sub.Endpoint) {
            // Lambda ARN — link if already discovered
            this.addEdge(topic.TopicArn, sub.Endpoint, "triggers");
          }
        }
      } catch { /* skip */ }
    }
  }

  private async discoverSQSDependencies(sqsClient: SQSClient): Promise<void> {
    const res = await sqsClient.send(new ListQueuesCommand({}));
    for (const queueUrl of res.QueueUrls ?? []) {
      const queueName = queueUrl.split("/").pop() ?? queueUrl;
      this.addNode(queueUrl, "SQSQueue", queueName);
      // Discover dead-letter queue (redrive policy) relationships
      try {
        const attrs = await sqsClient.send(new GetQueueAttributesCommand({
          QueueUrl: queueUrl,
          AttributeNames: ["RedrivePolicy", "QueueArn"],
        }));
        const queueArn = attrs.Attributes?.QueueArn;
        if (queueArn) {
          // Re-register with ARN so SNS edges can link
          this.addNode(queueArn, "SQSQueue", queueName);
        }
        const redrivePolicy = attrs.Attributes?.RedrivePolicy;
        if (redrivePolicy) {
          try {
            const policy = JSON.parse(redrivePolicy);
            if (policy.deadLetterTargetArn) {
              const dlqName = (policy.deadLetterTargetArn as string).split(":").pop() ?? policy.deadLetterTargetArn;
              this.addNode(policy.deadLetterTargetArn, "SQSQueue", dlqName);
              this.addEdge(queueUrl, policy.deadLetterTargetArn, "dead-letter to");
            }
          } catch { /* invalid JSON */ }
        }
      } catch { /* skip */ }
    }
  }

  private async discoverCloudFrontDependencies(accountId: string, roleName?: string): Promise<void> {
    const { CloudFrontClient, ListDistributionsCommand } = await import("@aws-sdk/client-cloudfront");
    const client = await getClientForAccount(CloudFrontClient, accountId, "us-east-1", roleName);
    const res = await client.send(new ListDistributionsCommand({}));
    for (const dist of res.DistributionList?.Items ?? []) {
      if (!dist.Id) continue;
      this.addNode(dist.Id, "CloudFrontDistribution", dist.DomainName ?? dist.Id);
      // Link to S3 origins
      for (const origin of dist.Origins?.Items ?? []) {
        if (origin.DomainName?.includes(".s3.")) {
          const bucketName = origin.DomainName.split(".s3.")[0];
          this.addNode(bucketName, "S3Bucket", bucketName);
          this.addEdge(dist.Id, bucketName, "origin");
        }
      }
    }
  }

  private async discoverAPIGatewayDependencies(accountId: string, region: string, roleName?: string): Promise<void> {
    // REST APIs
    try {
      const { APIGatewayClient, GetRestApisCommand, GetResourcesCommand, GetIntegrationCommand } = await import("@aws-sdk/client-api-gateway");
      const client = await getClientForAccount(APIGatewayClient, accountId, region, roleName);
      const res = await client.send(new GetRestApisCommand({}));
      for (const api of res.items ?? []) {
        if (!api.id) continue;
        this.addNode(api.id, "APIGatewayRestAPI", api.name ?? api.id);
        // Discover Lambda integrations
        try {
          const resources = await client.send(new GetResourcesCommand({ restApiId: api.id }));
          for (const resource of resources.items ?? []) {
            for (const method of Object.keys(resource.resourceMethods ?? {})) {
              try {
                const integration = await client.send(new GetIntegrationCommand({
                  restApiId: api.id,
                  resourceId: resource.id!,
                  httpMethod: method,
                }));
                if (integration.type === "AWS_PROXY" && integration.uri?.includes("lambda")) {
                  // Extract Lambda ARN from the integration URI
                  const arnMatch = integration.uri.match(/arn:aws:lambda:[^:]+:\d+:function:[^/]+/);
                  if (arnMatch) {
                    this.addEdge(api.id, arnMatch[0], "invokes");
                  }
                }
              } catch { /* skip individual method */ }
            }
          }
        } catch { /* skip resource discovery */ }
      }
    } catch { /* skip */ }
    // HTTP APIs
    try {
      const { ApiGatewayV2Client, GetApisCommand, GetIntegrationsCommand } = await import("@aws-sdk/client-apigatewayv2");
      const client = await getClientForAccount(ApiGatewayV2Client, accountId, region, roleName);
      const res = await client.send(new GetApisCommand({}));
      for (const api of res.Items ?? []) {
        if (!api.ApiId) continue;
        this.addNode(api.ApiId, "APIGatewayHttpAPI", api.Name ?? api.ApiId);
        // Discover Lambda integrations
        try {
          const integrations = await client.send(new GetIntegrationsCommand({ ApiId: api.ApiId }));
          for (const integ of integrations.Items ?? []) {
            if (integ.IntegrationType === "AWS_PROXY" && integ.IntegrationUri?.includes("lambda")) {
              this.addEdge(api.ApiId, integ.IntegrationUri, "invokes");
            }
          }
        } catch { /* skip */ }
      }
    } catch { /* skip */ }
  }


  private addNode(
    resourceId: string,
    resourceType: GraphResourceType,
    displayName: string
  ): void {
    if (!this.nodes.has(resourceId)) {
      this.nodes.set(resourceId, {
        resourceId,
        resourceType,
        accountId: this.accountId,
        region: this.region,
        displayName,
      });
    }
  }

  private addEdge(
    sourceResourceId: string,
    targetResourceId: string,
    relationshipLabel: string
  ): void {
    this.edges.push({
      sourceResourceId,
      targetResourceId,
      relationshipLabel,
    });
  }

  private getNameTag(
    tags?: Array<{ Key?: string; Value?: string }>
  ): string | undefined {
    return tags?.find((t) => t.Key === "Name")?.Value;
  }

  private extractRoleNameFromInstanceProfile(
    instanceProfileArn: string
  ): string | undefined {
    // Instance profile ARN format: arn:aws:iam::<account>:instance-profile/<name>
    // The role name is typically the same as the instance profile name
    const parts = instanceProfileArn.split("/");
    return parts.length > 1 ? parts[parts.length - 1] : undefined;
  }
}
