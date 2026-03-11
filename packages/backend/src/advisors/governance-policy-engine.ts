import {
  EC2Client,
  DescribeInstancesCommand,
  DescribeVolumesCommand,
  DescribeSecurityGroupsCommand,
} from "@aws-sdk/client-ec2";
import {
  IAMClient,
  ListUsersCommand,
  ListMFADevicesCommand,
  ListAccessKeysCommand,
  ListRolesCommand,
  ListAttachedRolePoliciesCommand,
} from "@aws-sdk/client-iam";
import { LambdaClient, ListFunctionsCommand } from "@aws-sdk/client-lambda";
import { RDSClient, DescribeDBInstancesCommand } from "@aws-sdk/client-rds";
import {
  ElasticLoadBalancingV2Client,
  DescribeLoadBalancersCommand,
} from "@aws-sdk/client-elastic-load-balancing-v2";
import type {
  Recommendation,
  ScanError,
  GovernancePolicy,
  ResourceType,
} from "@governance-engine/shared";
import { GovernanceDataRepository } from "../repository";
import { getClientForAccount } from "../credentials";
import { evaluateCondition, extractPropertyValue } from "./condition-evaluator";
import {
  mapEC2Properties,
  mapEBSProperties,
  mapSecurityGroupProperties,
  mapIAMUserProperties,
  mapIAMRoleProperties,
  mapLambdaProperties,
  mapRDSProperties,
  mapLoadBalancerProperties,
  type PropertyMap,
  type IAMUserMetadata,
} from "./resource-property-mapper";

export interface PolicyEngineInput {
  accountId: string;
  region: string;
  crossAccountRoleArn?: string;
}

export interface PolicyEngineOutput {
  recommendations: Recommendation[];
  resourcesEvaluated: number;
  errors: ScanError[];
}

export class GovernancePolicyEngine {
  private scanId: string;

  constructor(scanId: string) {
    this.scanId = scanId;
  }

  async evaluate(input: PolicyEngineInput): Promise<PolicyEngineOutput> {
    const recommendations: Recommendation[] = [];
    const errors: ScanError[] = [];
    let resourcesEvaluated = 0;

    const repo = new GovernanceDataRepository();

    // Step 1: Load all policies from DynamoDB
    let allPolicies: GovernancePolicy[];
    try {
      allPolicies = await repo.listPolicies();
    } catch (err: unknown) {
      const error = err as Error & { name?: string };
      errors.push({
        accountId: input.accountId,
        region: input.region,
        errorCode: error.name ?? "DynamoDBError",
        errorMessage: `Failed to load governance policies: ${error.message}`,
      });
      return { recommendations: [], resourcesEvaluated: 0, errors };
    }

    // Step 2: Filter to enabled policies only
    const enabledPolicies = allPolicies.filter((p) => p.enabled === true);
    if (enabledPolicies.length === 0) {
      return { recommendations: [], resourcesEvaluated: 0, errors: [] };
    }

    // Step 3: Group policies by resourceType
    const policyGroups = new Map<ResourceType, GovernancePolicy[]>();
    for (const policy of enabledPolicies) {
      const group = policyGroups.get(policy.resourceType) ?? [];
      group.push(policy);
      policyGroups.set(policy.resourceType, group);
    }

    // Step 4: For each resource type group, query resources and evaluate
    const roleName = input.crossAccountRoleArn?.split("/").pop();

    for (const [resourceType, policies] of policyGroups) {
      try {
        const { resources, evaluated } = await this.queryResources(
          resourceType,
          input.accountId,
          input.region,
          roleName
        );
        resourcesEvaluated += evaluated;

        for (const { resourceId, properties } of resources) {
          for (const policy of policies) {
            try {
              const propertyValue = extractPropertyValue(
                properties,
                policy.condition.property
              );
              const isViolation = evaluateCondition(
                propertyValue,
                policy.condition.operator,
                policy.condition.value
              );

              if (isViolation) {
                recommendations.push(
                  this.createRecommendation(input, policy, resourceId, propertyValue)
                );
              }
            } catch (err: unknown) {
              const error = err as Error & { name?: string };
              errors.push({
                accountId: input.accountId,
                region: input.region,
                resourceType,
                errorCode: error.name ?? "PolicyEvaluationError",
                errorMessage: `Policy "${policy.name}" (${policy.policyId}) failed on resource ${resourceId}: ${error.message}`,
              });
            }
          }
        }
      } catch (err: unknown) {
        const error = err as Error & { name?: string };
        errors.push({
          accountId: input.accountId,
          region: input.region,
          resourceType,
          errorCode: error.name ?? "ResourceQueryError",
          errorMessage: `Failed to query ${resourceType} resources: ${error.message}`,
        });
      }
    }

    return { recommendations, resourcesEvaluated, errors };
  }

  private async queryResources(
    resourceType: ResourceType,
    accountId: string,
    region: string,
    roleName?: string
  ): Promise<{ resources: { resourceId: string; properties: PropertyMap }[]; evaluated: number }> {
    const resources: { resourceId: string; properties: PropertyMap }[] = [];

    switch (resourceType) {
      case "EC2Instance": {
        const ec2 = await getClientForAccount(EC2Client, accountId, region, roleName);
        const response = await ec2.send(new DescribeInstancesCommand({}));
        for (const reservation of response.Reservations ?? []) {
          for (const instance of reservation.Instances ?? []) {
            if (instance.InstanceId) {
              resources.push({
                resourceId: instance.InstanceId,
                properties: mapEC2Properties(instance),
              });
            }
          }
        }
        break;
      }

      case "EBSVolume": {
        const ec2 = await getClientForAccount(EC2Client, accountId, region, roleName);
        const response = await ec2.send(new DescribeVolumesCommand({}));
        for (const volume of response.Volumes ?? []) {
          if (volume.VolumeId) {
            resources.push({
              resourceId: volume.VolumeId,
              properties: mapEBSProperties(volume),
            });
          }
        }
        break;
      }

      case "SecurityGroup": {
        const ec2 = await getClientForAccount(EC2Client, accountId, region, roleName);
        const response = await ec2.send(new DescribeSecurityGroupsCommand({}));
        for (const sg of response.SecurityGroups ?? []) {
          if (sg.GroupId) {
            resources.push({
              resourceId: sg.GroupId,
              properties: mapSecurityGroupProperties(sg),
            });
          }
        }
        break;
      }

      case "IAMUser": {
        const iam = await getClientForAccount(IAMClient, accountId, region, roleName);
        const response = await iam.send(new ListUsersCommand({}));
        for (const user of response.Users ?? []) {
          if (user.UserName) {
            const metadata = await this.getIAMUserMetadata(iam, user.UserName);
            resources.push({
              resourceId: user.UserName,
              properties: mapIAMUserProperties(user, metadata),
            });
          }
        }
        break;
      }

      case "IAMRole": {
        const iam = await getClientForAccount(IAMClient, accountId, region, roleName);
        const response = await iam.send(new ListRolesCommand({}));
        for (const role of response.Roles ?? []) {
          if (role.RoleName) {
            // Get attached policy count
            try {
              const attachedResponse = await iam.send(
                new ListAttachedRolePoliciesCommand({ RoleName: role.RoleName })
              );
              const props = mapIAMRoleProperties(role);
              props.AttachedPolicyCount = attachedResponse.AttachedPolicies?.length ?? 0;
              resources.push({
                resourceId: role.RoleName,
                properties: props,
              });
            } catch {
              resources.push({
                resourceId: role.RoleName,
                properties: mapIAMRoleProperties(role),
              });
            }
          }
        }
        break;
      }

      case "LambdaFunction": {
        const lambda = await getClientForAccount(LambdaClient, accountId, region, roleName);
        const response = await lambda.send(new ListFunctionsCommand({}));
        for (const fn of response.Functions ?? []) {
          if (fn.FunctionName) {
            resources.push({
              resourceId: fn.FunctionName,
              properties: mapLambdaProperties(fn),
            });
          }
        }
        break;
      }

      case "RDSInstance": {
        const rds = await getClientForAccount(RDSClient, accountId, region, roleName);
        const response = await rds.send(new DescribeDBInstancesCommand({}));
        for (const instance of response.DBInstances ?? []) {
          if (instance.DBInstanceIdentifier) {
            resources.push({
              resourceId: instance.DBInstanceIdentifier,
              properties: mapRDSProperties(instance),
            });
          }
        }
        break;
      }

      case "LoadBalancer": {
        const elbv2 = await getClientForAccount(
          ElasticLoadBalancingV2Client, accountId, region, roleName
        );
        const response = await elbv2.send(new DescribeLoadBalancersCommand({}));
        for (const lb of response.LoadBalancers ?? []) {
          if (lb.LoadBalancerArn) {
            resources.push({
              resourceId: lb.LoadBalancerArn,
              properties: mapLoadBalancerProperties(lb),
            });
          }
        }
        break;
      }

      // Unsupported resource types — skip with log
      case "ElasticIP":
      case "ECSService":
      case "NATGateway":
      case "CloudWatchLogGroup":
        console.log(`Skipping unsupported resource type for policy evaluation: ${resourceType}`);
        return { resources: [], evaluated: 0 };

      default:
        console.log(`Unknown resource type for policy evaluation: ${resourceType}`);
        return { resources: [], evaluated: 0 };
    }

    return { resources, evaluated: resources.length };
  }

  private async getIAMUserMetadata(
    iam: IAMClient,
    userName: string
  ): Promise<IAMUserMetadata> {
    let mfaEnabled = false;
    let accessKeyAge: number | undefined;

    try {
      const mfaResponse = await iam.send(
        new ListMFADevicesCommand({ UserName: userName })
      );
      mfaEnabled = (mfaResponse.MFADevices ?? []).length > 0;
    } catch {
      // Best-effort MFA check
    }

    try {
      const keysResponse = await iam.send(
        new ListAccessKeysCommand({ UserName: userName })
      );
      const keys = keysResponse.AccessKeyMetadata ?? [];
      if (keys.length > 0 && keys[0].CreateDate) {
        const ageMs = Date.now() - keys[0].CreateDate.getTime();
        accessKeyAge = Math.floor(ageMs / (1000 * 60 * 60 * 24)); // days
      }
    } catch {
      // Best-effort access key check
    }

    return { mfaEnabled, accessKeyAge };
  }

  private createRecommendation(
    input: PolicyEngineInput,
    policy: GovernancePolicy,
    resourceId: string,
    propertyValue: unknown
  ): Recommendation {
    const suggestedAction = this.buildSuggestedAction(policy, propertyValue);

    return {
      recommendationId: crypto.randomUUID(),
      scanId: this.scanId,
      accountId: input.accountId,
      region: input.region,
      advisorType: "GovernancePolicyEngine" as any,
      resourceId,
      resourceType: policy.resourceType,
      issueDescription: `Policy "${policy.name}" violated: ${policy.condition.property} ${policy.condition.operator} ${JSON.stringify(policy.condition.value)} (actual: ${JSON.stringify(propertyValue)})`,
      suggestedAction,
      riskLevel: policy.severity,
      explanation: `Governance policy "${policy.name}" checks that ${policy.condition.property} ${this.operatorDescription(policy.condition.operator)} ${JSON.stringify(policy.condition.value)}. ${policy.description || ""}`.trim(),
      estimatedMonthlySavings: null,
      availableActions: [],
      dependencies: [],
      createdAt: new Date().toISOString(),
    };
  }

  private buildSuggestedAction(policy: GovernancePolicy, _propertyValue: unknown): string {
    const { property, operator, value } = policy.condition;

    switch (operator) {
      case "equals":
        return `Change ${property} to ${JSON.stringify(value)}`;
      case "not_equals":
        return `Change ${property} to a value other than ${JSON.stringify(value)}`;
      case "greater_than":
        return `Reduce ${property} to ${value} or below`;
      case "less_than":
        return `Increase ${property} to ${value} or above`;
      case "in":
        return `Change ${property} to a value in ${JSON.stringify(value)}`;
      case "not_in":
        return `Change ${property} to a value not in ${JSON.stringify(value)}`;
      case "contains":
        return `Ensure ${property} contains ${JSON.stringify(value)}`;
      case "not_contains":
        return `Remove ${JSON.stringify(value)} from ${property}`;
      case "exists":
        return `Add the ${property} property to the resource`;
      case "not_exists":
        return `Remove the ${property} property from the resource`;
      default:
        return `Update ${property} to comply with policy "${policy.name}"`;
    }
  }

  private operatorDescription(operator: string): string {
    switch (operator) {
      case "equals": return "equals";
      case "not_equals": return "does not equal";
      case "greater_than": return "is not greater than";
      case "less_than": return "is not less than";
      case "in": return "is in";
      case "not_in": return "is not in";
      case "contains": return "contains";
      case "not_contains": return "does not contain";
      case "exists": return "exists";
      case "not_exists": return "does not exist";
      default: return operator;
    }
  }
}
