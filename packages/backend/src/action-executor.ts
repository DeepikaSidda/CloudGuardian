import { EC2Client, TerminateInstancesCommand, StopInstancesCommand, DeleteVolumeCommand, ReleaseAddressCommand, DeleteSecurityGroupCommand, DeleteNatGatewayCommand } from "@aws-sdk/client-ec2";
import { LambdaClient, DeleteFunctionCommand } from "@aws-sdk/client-lambda";
import { RDSClient, StopDBInstanceCommand, DeleteDBInstanceCommand } from "@aws-sdk/client-rds";
import { ECSClient, UpdateServiceCommand } from "@aws-sdk/client-ecs";
import {
  ResourceType,
  ActionType,
  DependencyInfo,
  RESOURCE_ACTION_MAP,
} from "@governance-engine/shared";
import { getClientForAccount } from "./credentials";
import { GovernanceDataRepository } from "./repository";

export interface ActionExecutorInput {
  actionId: string;
  userId: string;
  recommendationId: string;
  accountId: string;
  region: string;
  resourceId: string;
  resourceType: ResourceType;
  actionType: ActionType;
  crossAccountRoleArn?: string;
  dependencyAcknowledgment?: boolean;
  dependencies?: DependencyInfo[];
}

export interface ActionExecutorOutput {
  actionId: string;
  status: "SUCCESS" | "FAILED";
  error?: string;
  timestamp: string;
}

export class ActionExecutor {
  private readonly repository: GovernanceDataRepository;

  constructor(repository: GovernanceDataRepository) {
    this.repository = repository;
  }

  async execute(input: ActionExecutorInput): Promise<ActionExecutorOutput> {
    const timestamp = new Date().toISOString();

    // Validate action type against RESOURCE_ACTION_MAP
    const allowedActions = RESOURCE_ACTION_MAP[input.resourceType];
    if (!allowedActions || !allowedActions.includes(input.actionType)) {
      const output = this.failedOutput(input.actionId, timestamp, `Action '${input.actionType}' is not allowed for resource type '${input.resourceType}'`);
      await this.logAction(input, output);
      return output;
    }

    // Check dependency acknowledgment
    if (input.dependencies && input.dependencies.length > 0 && !input.dependencyAcknowledgment) {
      const output = this.failedOutput(input.actionId, timestamp, `Resource has ${input.dependencies.length} dependencies. Explicit dependency acknowledgment is required to proceed.`);
      await this.logAction(input, output);
      return output;
    }

    try {
      await this.executeAction(input);
      const output: ActionExecutorOutput = {
        actionId: input.actionId,
        status: "SUCCESS",
        timestamp,
      };
      await this.logAction(input, output);
      return output;
    } catch (err: unknown) {
      const error = err as Error;
      const output = this.failedOutput(input.actionId, timestamp, error.message ?? "Unknown error");
      await this.logAction(input, output);
      return output;
    }
  }

  private async executeAction(input: ActionExecutorInput): Promise<void> {
    const roleName = input.crossAccountRoleArn?.split("/").pop();

    switch (input.resourceType) {
      case "EC2Instance":
        await this.executeEc2Action(input.accountId, input.region, input.resourceId, input.actionType, roleName);
        break;
      case "EBSVolume":
        await this.executeEbsAction(input.accountId, input.region, input.resourceId, roleName);
        break;
      case "ElasticIP":
        await this.executeEipAction(input.accountId, input.region, input.resourceId, roleName);
        break;
      case "LambdaFunction":
        await this.executeLambdaAction(input.accountId, input.region, input.resourceId, roleName);
        break;
      case "RDSInstance":
        await this.executeRdsAction(input.accountId, input.region, input.resourceId, input.actionType, roleName);
        break;
      case "ECSService":
        await this.executeEcsAction(input.accountId, input.region, input.resourceId, roleName);
        break;
      case "SecurityGroup":
        await this.executeSecurityGroupAction(input.accountId, input.region, input.resourceId, roleName);
        break;
      case "NATGateway":
        await this.executeNatGatewayAction(input.accountId, input.region, input.resourceId, roleName);
        break;
      default:
        throw new Error(`Unsupported resource type: ${input.resourceType}`);
    }
  }

  private async executeEc2Action(accountId: string, region: string, resourceId: string, actionType: ActionType, roleName?: string): Promise<void> {
    const ec2 = await getClientForAccount(EC2Client, accountId, region, roleName);
    if (actionType === "terminate") {
      await ec2.send(new TerminateInstancesCommand({ InstanceIds: [resourceId] }));
    } else if (actionType === "stop") {
      await ec2.send(new StopInstancesCommand({ InstanceIds: [resourceId] }));
    }
  }

  private async executeEbsAction(accountId: string, region: string, resourceId: string, roleName?: string): Promise<void> {
    const ec2 = await getClientForAccount(EC2Client, accountId, region, roleName);
    await ec2.send(new DeleteVolumeCommand({ VolumeId: resourceId }));
  }

  private async executeEipAction(accountId: string, region: string, resourceId: string, roleName?: string): Promise<void> {
    const ec2 = await getClientForAccount(EC2Client, accountId, region, roleName);
    await ec2.send(new ReleaseAddressCommand({ AllocationId: resourceId }));
  }

  private async executeLambdaAction(accountId: string, region: string, resourceId: string, roleName?: string): Promise<void> {
    const lambda = await getClientForAccount(LambdaClient, accountId, region, roleName);
    await lambda.send(new DeleteFunctionCommand({ FunctionName: resourceId }));
  }

  private async executeRdsAction(accountId: string, region: string, resourceId: string, actionType: ActionType, roleName?: string): Promise<void> {
    const rds = await getClientForAccount(RDSClient, accountId, region, roleName);
    if (actionType === "stop") {
      await rds.send(new StopDBInstanceCommand({ DBInstanceIdentifier: resourceId }));
    } else if (actionType === "delete") {
      await rds.send(new DeleteDBInstanceCommand({ DBInstanceIdentifier: resourceId, SkipFinalSnapshot: true }));
    }
  }

  private async executeEcsAction(accountId: string, region: string, resourceId: string, roleName?: string): Promise<void> {
    const ecs = await getClientForAccount(ECSClient, accountId, region, roleName);
    // resourceId expected as "cluster/service" or just service ARN
    const parts = resourceId.split("/");
    const cluster = parts.length > 1 ? parts.slice(0, -1).join("/") : undefined;
    const service = parts[parts.length - 1];
    await ecs.send(new UpdateServiceCommand({ cluster, service, desiredCount: 0 }));
  }

  private async executeSecurityGroupAction(accountId: string, region: string, resourceId: string, roleName?: string): Promise<void> {
    const ec2 = await getClientForAccount(EC2Client, accountId, region, roleName);
    await ec2.send(new DeleteSecurityGroupCommand({ GroupId: resourceId }));
  }

  private async executeNatGatewayAction(accountId: string, region: string, resourceId: string, roleName?: string): Promise<void> {
    const ec2 = await getClientForAccount(EC2Client, accountId, region, roleName);
    await ec2.send(new DeleteNatGatewayCommand({ NatGatewayId: resourceId }));
  }

  private failedOutput(actionId: string, timestamp: string, error: string): ActionExecutorOutput {
    return { actionId, status: "FAILED", error, timestamp };
  }

  private async logAction(input: ActionExecutorInput, output: ActionExecutorOutput): Promise<void> {
    try {
      await this.repository.putAction({
        actionId: input.actionId,
        recommendationId: input.recommendationId,
        userId: input.userId,
        accountId: input.accountId,
        region: input.region,
        resourceId: input.resourceId,
        resourceType: input.resourceType,
        actionType: input.actionType,
        status: output.status,
        initiatedAt: output.timestamp,
        completedAt: new Date().toISOString(),
        result: output.error ?? `Successfully executed ${input.actionType} on ${input.resourceType} ${input.resourceId}`,
      });
    } catch {
      // Logging failure should not cause the action to fail
      console.error(`Failed to log action ${input.actionId}`);
    }
  }
}


// Lambda handler for CDK integration
export async function handler(event: ActionExecutorInput): Promise<ActionExecutorOutput> {
  const repository = new GovernanceDataRepository();
  const executor = new ActionExecutor(repository);
  return executor.execute(event);
}
