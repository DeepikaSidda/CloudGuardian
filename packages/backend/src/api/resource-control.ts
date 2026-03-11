import { EC2Client, StopInstancesCommand, StartInstancesCommand, TerminateInstancesCommand, DeleteVolumeCommand, ReleaseAddressCommand, DeleteSecurityGroupCommand } from "@aws-sdk/client-ec2";
import { LambdaClient, DeleteFunctionCommand } from "@aws-sdk/client-lambda";
import { S3Client, DeleteBucketCommand, ListObjectsV2Command, DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { CloudWatchLogsClient, DeleteLogGroupCommand } from "@aws-sdk/client-cloudwatch-logs";
import { IAMClient, DeleteRoleCommand, DeleteUserCommand } from "@aws-sdk/client-iam";

export interface ResourceControlInput {
  service: string;
  action: string;
  resourceId: string;
  region: string;
}

export interface ResourceControlOutput {
  success: boolean;
  message: string;
  service: string;
  action: string;
  resourceId: string;
}

export async function executeResourceControl(input: ResourceControlInput): Promise<ResourceControlOutput> {
  const { service, action, resourceId, region } = input;

  try {
    switch (service) {
      case "EC2 Instances": {
        const ec2 = new EC2Client({ region });
        if (action === "stop") await ec2.send(new StopInstancesCommand({ InstanceIds: [resourceId] }));
        else if (action === "start") await ec2.send(new StartInstancesCommand({ InstanceIds: [resourceId] }));
        else if (action === "terminate") await ec2.send(new TerminateInstancesCommand({ InstanceIds: [resourceId] }));
        else throw new Error(`Unsupported action '${action}' for EC2`);
        break;
      }
      case "Lambda Functions": {
        const client = new LambdaClient({ region });
        if (action === "delete") await client.send(new DeleteFunctionCommand({ FunctionName: resourceId }));
        else throw new Error(`Unsupported action '${action}' for Lambda`);
        break;
      }
      case "S3 Buckets": {
        const s3 = new S3Client({ region });
        if (action === "delete") {
          // Empty bucket first, then delete
          let continuationToken: string | undefined;
          do {
            const list = await s3.send(new ListObjectsV2Command({ Bucket: resourceId, ContinuationToken: continuationToken }));
            if (list.Contents && list.Contents.length > 0) {
              await s3.send(new DeleteObjectsCommand({ Bucket: resourceId, Delete: { Objects: list.Contents.map(o => ({ Key: o.Key! })) } }));
            }
            continuationToken = list.NextContinuationToken;
          } while (continuationToken);
          await s3.send(new DeleteBucketCommand({ Bucket: resourceId }));
        } else throw new Error(`Unsupported action '${action}' for S3`);
        break;
      }
      case "EBS Volumes": {
        const ec2 = new EC2Client({ region });
        if (action === "delete") await ec2.send(new DeleteVolumeCommand({ VolumeId: resourceId }));
        else throw new Error(`Unsupported action '${action}' for EBS`);
        break;
      }
      case "Elastic IPs": {
        const ec2 = new EC2Client({ region });
        if (action === "release") await ec2.send(new ReleaseAddressCommand({ AllocationId: resourceId }));
        else throw new Error(`Unsupported action '${action}' for Elastic IP`);
        break;
      }
      case "Security Groups": {
        const ec2 = new EC2Client({ region });
        if (action === "delete") await ec2.send(new DeleteSecurityGroupCommand({ GroupId: resourceId }));
        else throw new Error(`Unsupported action '${action}' for Security Group`);
        break;
      }
      case "CloudWatch Log Groups": {
        const client = new CloudWatchLogsClient({ region });
        if (action === "delete") await client.send(new DeleteLogGroupCommand({ logGroupName: resourceId }));
        else throw new Error(`Unsupported action '${action}' for Log Group`);
        break;
      }
      case "IAM Roles": {
        const client = new IAMClient({ region });
        if (action === "delete") await client.send(new DeleteRoleCommand({ RoleName: resourceId }));
        else throw new Error(`Unsupported action '${action}' for IAM Role`);
        break;
      }
      case "IAM Users": {
        const client = new IAMClient({ region });
        if (action === "delete") await client.send(new DeleteUserCommand({ UserName: resourceId }));
        else throw new Error(`Unsupported action '${action}' for IAM User`);
        break;
      }
      default:
        throw new Error(`Service '${service}' does not support resource control actions`);
    }

    return { success: true, message: `Successfully executed '${action}' on ${resourceId}`, service, action, resourceId };
  } catch (err: unknown) {
    const error = err as Error;
    return { success: false, message: error.message ?? "Unknown error", service, action, resourceId };
  }
}
