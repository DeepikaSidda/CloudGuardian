import {
  IAMClient,
  ListUsersCommand,
  ListRolesCommand,
  ListAttachedUserPoliciesCommand,
  ListAttachedRolePoliciesCommand,
  GetPolicyCommand,
  GetPolicyVersionCommand,
  ListUserPoliciesCommand,
  GetUserPolicyCommand,
  ListRolePoliciesCommand,
  GetRolePolicyCommand,
  GetLoginProfileCommand,
  ListInstanceProfilesForRoleCommand,
  type User,
  type Role,
} from "@aws-sdk/client-iam";
import {
  LambdaClient,
  ListFunctionsCommand,
} from "@aws-sdk/client-lambda";
import {
  EC2Client,
  DescribeInstancesCommand,
} from "@aws-sdk/client-ec2";
import {
  ECSClient,
  ListClustersCommand,
  ListServicesCommand,
  DescribeServicesCommand,
} from "@aws-sdk/client-ecs";
import {
  CloudTrailClient,
  LookupEventsCommand,
} from "@aws-sdk/client-cloudtrail";
import {
  Recommendation,
  DependencyInfo,
  ScanError,
  RESOURCE_ACTION_MAP,
} from "@governance-engine/shared";
import { getClientForAccount } from "../credentials";

export interface PermissionDriftDetectorInput {
  accountId: string;
  region: string;
  lookbackDays: number;
  crossAccountRoleArn?: string;
}

export interface PermissionDriftDetectorOutput {
  recommendations: Recommendation[];
  resourcesEvaluated: number;
  errors: ScanError[];
}

interface IAMEntityInfo {
  name: string;
  arn: string;
  type: "IAMUser" | "IAMRole";
  grantedPermissions: Set<string>;
  hasAdminAccess: boolean;
  trustedServices?: string[]; // Services from AssumeRolePolicyDocument (roles only)
}

export class PermissionDriftDetector {
  private scanId: string;

  constructor(scanId: string) {
    this.scanId = scanId;
  }

  async analyze(input: PermissionDriftDetectorInput): Promise<PermissionDriftDetectorOutput> {
    const recommendations: Recommendation[] = [];
    const errors: ScanError[] = [];
    let resourcesEvaluated = 0;

    const roleName = input.crossAccountRoleArn?.split("/").pop();

    const iam = await getClientForAccount(IAMClient, input.accountId, input.region, roleName);
    const cloudtrail = await getClientForAccount(CloudTrailClient, input.accountId, input.region, roleName);
    const lambda = await getClientForAccount(LambdaClient, input.accountId, input.region, roleName);
    const ec2 = await getClientForAccount(EC2Client, input.accountId, input.region, roleName);
    const ecs = await getClientForAccount(ECSClient, input.accountId, input.region, roleName);

    // Collect all IAM entities (users + roles)
    let entities: IAMEntityInfo[] = [];

    try {
      const users = await this.listUsers(iam);
      for (const user of users) {
        try {
          const entity = await this.buildUserEntity(iam, user, errors, input);
          entities.push(entity);
        } catch (err: unknown) {
          const error = err as Error & { name?: string };
          errors.push({
            accountId: input.accountId,
            region: input.region,
            resourceType: "IAMUser",
            errorCode: error.name ?? "UnknownError",
            errorMessage: `Failed to analyze user ${user.UserName}: ${error.message}`,
          });
        }
      }
      resourcesEvaluated += users.length;
    } catch (err: unknown) {
      const error = err as Error & { name?: string };
      errors.push({
        accountId: input.accountId,
        region: input.region,
        resourceType: "IAMUser",
        errorCode: error.name ?? "UnknownError",
        errorMessage: `Failed to list IAM users: ${error.message}`,
      });
    }

    try {
      const roles = await this.listRoles(iam);
      for (const role of roles) {
        // Skip AWS service-linked roles
        if (role.Path?.startsWith("/aws-service-role/")) continue;

        try {
          const entity = await this.buildRoleEntity(iam, role, errors, input);
          entities.push(entity);
        } catch (err: unknown) {
          const error = err as Error & { name?: string };
          errors.push({
            accountId: input.accountId,
            region: input.region,
            resourceType: "IAMRole",
            errorCode: error.name ?? "UnknownError",
            errorMessage: `Failed to analyze role ${role.RoleName}: ${error.message}`,
          });
        }
      }
      resourcesEvaluated += roles.length;
    } catch (err: unknown) {
      const error = err as Error & { name?: string };
      errors.push({
        accountId: input.accountId,
        region: input.region,
        resourceType: "IAMRole",
        errorCode: error.name ?? "UnknownError",
        errorMessage: `Failed to list IAM roles: ${error.message}`,
      });
    }

    // For each entity, query CloudTrail and compute drift
    for (const entity of entities) {
      try {
        const exercisedActions = await this.getExercisedActions(cloudtrail, entity, input);
        const unusedPermissions = this.computeUnusedPermissions(entity.grantedPermissions, exercisedActions);

        if (unusedPermissions.size > 0) {
          const isHighRisk = entity.hasAdminAccess && !this.hasExercisedAdminActions(exercisedActions, entity.grantedPermissions);
          const rec = this.createDriftRecommendation(input, entity, unusedPermissions, isHighRisk);
          // Check dependencies for roles
          if (entity.type === "IAMRole") {
            await this.checkRoleDependencies(iam, lambda, ec2, ecs, entity, rec, input);
          }
          recommendations.push(rec);
        }

        // Check for deactivation candidates (users only, zero activity)
        if (entity.type === "IAMUser" && exercisedActions.size === 0) {
          const hasLogin = await this.hasLoginProfile(iam, entity.name);
          if (!hasLogin) {
            const rec = this.createDeactivationRecommendation(input, entity);
            recommendations.push(rec);
          }
        }
      } catch (err: unknown) {
        const error = err as Error & { name?: string };
        errors.push({
          accountId: input.accountId,
          region: input.region,
          resourceType: entity.type,
          errorCode: error.name ?? "UnknownError",
          errorMessage: `Failed to analyze CloudTrail for ${entity.name}: ${error.message}`,
        });
      }
    }

    return { recommendations, resourcesEvaluated, errors };
  }

  private async listUsers(iam: IAMClient): Promise<User[]> {
    const users: User[] = [];
    let marker: string | undefined;

    do {
      const response = await iam.send(new ListUsersCommand({ Marker: marker }));
      users.push(...(response.Users ?? []));
      marker = response.IsTruncated ? response.Marker : undefined;
    } while (marker);

    return users;
  }

  private async listRoles(iam: IAMClient): Promise<Role[]> {
    const roles: Role[] = [];
    let marker: string | undefined;

    do {
      const response = await iam.send(new ListRolesCommand({ Marker: marker }));
      roles.push(...(response.Roles ?? []));
      marker = response.IsTruncated ? response.Marker : undefined;
    } while (marker);

    return roles;
  }

  private async buildUserEntity(
    iam: IAMClient,
    user: User,
    errors: ScanError[],
    input: PermissionDriftDetectorInput
  ): Promise<IAMEntityInfo> {
    const entity: IAMEntityInfo = {
      name: user.UserName ?? "unknown",
      arn: user.Arn ?? "",
      type: "IAMUser",
      grantedPermissions: new Set<string>(),
      hasAdminAccess: false,
    };

    // Get attached managed policies
    const attachedResponse = await iam.send(
      new ListAttachedUserPoliciesCommand({ UserName: user.UserName })
    );
    for (const policy of attachedResponse.AttachedPolicies ?? []) {
      if (policy.PolicyArn) {
        await this.extractManagedPolicyPermissions(iam, policy.PolicyArn, policy.PolicyName, entity, errors, input);
      }
    }

    // Get inline policies
    const inlineResponse = await iam.send(
      new ListUserPoliciesCommand({ UserName: user.UserName })
    );
    for (const policyName of inlineResponse.PolicyNames ?? []) {
      try {
        const policyResponse = await iam.send(
          new GetUserPolicyCommand({ UserName: user.UserName, PolicyName: policyName })
        );
        this.parseInlinePolicyDocument(policyResponse.PolicyDocument, entity, errors, input, policyName);
      } catch (err: unknown) {
        const error = err as Error & { name?: string };
        errors.push({
          accountId: input.accountId,
          region: input.region,
          resourceType: "IAMUser",
          errorCode: error.name ?? "PolicyParseError",
          errorMessage: `Failed to get inline policy ${policyName} for user ${user.UserName}: ${error.message}`,
        });
      }
    }

    return entity;
  }

  private async buildRoleEntity(
    iam: IAMClient,
    role: Role,
    errors: ScanError[],
    input: PermissionDriftDetectorInput
  ): Promise<IAMEntityInfo> {
    const entity: IAMEntityInfo = {
      name: role.RoleName ?? "unknown",
      arn: role.Arn ?? "",
      type: "IAMRole",
      grantedPermissions: new Set<string>(),
      hasAdminAccess: false,
      trustedServices: [],
    };

    // Extract trusted services from AssumeRolePolicyDocument
    try {
      if (role.AssumeRolePolicyDocument) {
        const trustDoc = JSON.parse(decodeURIComponent(role.AssumeRolePolicyDocument));
        const statements = Array.isArray(trustDoc.Statement) ? trustDoc.Statement : [trustDoc.Statement].filter(Boolean);
        for (const stmt of statements) {
          if (stmt.Effect !== "Allow") continue;
          const principals = stmt.Principal?.Service;
          if (principals) {
            const services = Array.isArray(principals) ? principals : [principals];
            entity.trustedServices!.push(...services);
          }
        }
      }
    } catch {
      // Trust policy parse failure is non-fatal
    }

    // Get attached managed policies
    const attachedResponse = await iam.send(
      new ListAttachedRolePoliciesCommand({ RoleName: role.RoleName })
    );
    for (const policy of attachedResponse.AttachedPolicies ?? []) {
      if (policy.PolicyArn) {
        await this.extractManagedPolicyPermissions(iam, policy.PolicyArn, policy.PolicyName, entity, errors, input);
      }
    }

    // Get inline policies
    const inlineResponse = await iam.send(
      new ListRolePoliciesCommand({ RoleName: role.RoleName })
    );
    for (const policyName of inlineResponse.PolicyNames ?? []) {
      try {
        const policyResponse = await iam.send(
          new GetRolePolicyCommand({ RoleName: role.RoleName, PolicyName: policyName })
        );
        this.parseInlinePolicyDocument(policyResponse.PolicyDocument, entity, errors, input, policyName);
      } catch (err: unknown) {
        const error = err as Error & { name?: string };
        errors.push({
          accountId: input.accountId,
          region: input.region,
          resourceType: "IAMRole",
          errorCode: error.name ?? "PolicyParseError",
          errorMessage: `Failed to get inline policy ${policyName} for role ${role.RoleName}: ${error.message}`,
        });
      }
    }

    return entity;
  }

  private async extractManagedPolicyPermissions(
    iam: IAMClient,
    policyArn: string,
    policyName: string | undefined,
    entity: IAMEntityInfo,
    errors: ScanError[],
    input: PermissionDriftDetectorInput
  ): Promise<void> {
    // Check for well-known admin policies by name
    if (policyName === "AdministratorAccess" || policyArn.endsWith("/AdministratorAccess")) {
      entity.hasAdminAccess = true;
      entity.grantedPermissions.add("*");
      return;
    }

    try {
      const policyMeta = await iam.send(new GetPolicyCommand({ PolicyArn: policyArn }));
      const versionId = policyMeta.Policy?.DefaultVersionId;
      if (!versionId) return;

      const versionResponse = await iam.send(
        new GetPolicyVersionCommand({ PolicyArn: policyArn, VersionId: versionId })
      );

      const document = versionResponse.PolicyVersion?.Document;
      if (!document) return;

      this.parsePolicyDocument(decodeURIComponent(document), entity, errors, input, policyArn);
    } catch (err: unknown) {
      const error = err as Error & { name?: string };
      errors.push({
        accountId: input.accountId,
        region: input.region,
        errorCode: error.name ?? "PolicyParseError",
        errorMessage: `Failed to parse managed policy ${policyArn}: ${error.message}`,
      });
    }
  }

  private parseInlinePolicyDocument(
    document: string | undefined,
    entity: IAMEntityInfo,
    errors: ScanError[],
    input: PermissionDriftDetectorInput,
    policyName: string
  ): void {
    if (!document) return;

    try {
      this.parsePolicyDocument(decodeURIComponent(document), entity, errors, input, policyName);
    } catch (err: unknown) {
      const error = err as Error & { name?: string };
      errors.push({
        accountId: input.accountId,
        region: input.region,
        errorCode: error.name ?? "PolicyParseError",
        errorMessage: `Failed to parse inline policy ${policyName}: ${error.message}`,
      });
    }
  }

  private parsePolicyDocument(
    documentJson: string,
    entity: IAMEntityInfo,
    errors: ScanError[],
    input: PermissionDriftDetectorInput,
    policyIdentifier: string
  ): void {
    try {
      const doc = JSON.parse(documentJson);
      const statements = Array.isArray(doc.Statement) ? doc.Statement : [doc.Statement].filter(Boolean);

      for (const statement of statements) {
        if (statement.Effect !== "Allow") continue;

        const actions = Array.isArray(statement.Action)
          ? statement.Action
          : [statement.Action].filter(Boolean);

        for (const action of actions) {
          if (action === "*") {
            entity.hasAdminAccess = true;
          }
          entity.grantedPermissions.add(action);
        }
      }
    } catch {
      // Log and skip unparseable policies
      console.warn(`Skipping unparseable policy: ${policyIdentifier}`);
      errors.push({
        accountId: input.accountId,
        region: input.region,
        errorCode: "PolicyParseError",
        errorMessage: `Could not parse policy document for ${policyIdentifier}`,
      });
    }
  }

  private async getExercisedActions(
    cloudtrail: CloudTrailClient,
    entity: IAMEntityInfo,
    input: PermissionDriftDetectorInput
  ): Promise<Set<string>> {
    const exercised = new Set<string>();
    const now = new Date();
    const lookbackStart = new Date(now.getTime() - input.lookbackDays * 24 * 60 * 60 * 1000);

    let nextToken: string | undefined;

    do {
      const response = await cloudtrail.send(
        new LookupEventsCommand({
          LookupAttributes: [
            {
              AttributeKey: "Username",
              AttributeValue: entity.name,
            },
          ],
          StartTime: lookbackStart,
          EndTime: now,
          NextToken: nextToken,
        })
      );

      for (const event of response.Events ?? []) {
        if (event.EventName) {
          // CloudTrail event names are API action names (e.g., "DescribeInstances")
          // We store them as-is since IAM actions use service:Action format
          const source = event.EventSource?.replace(".amazonaws.com", "") ?? "";
          exercised.add(`${source}:${event.EventName}`);
        }
      }

      nextToken = response.NextToken;
    } while (nextToken);

    return exercised;
  }

  /**
   * Compute the set difference: granted permissions minus exercised permissions.
   * Handles wildcards: if granted has "s3:*", any exercised "s3:XYZ" counts as used.
   */
  computeUnusedPermissions(
    granted: Set<string>,
    exercised: Set<string>
  ): Set<string> {
    const unused = new Set<string>();

    for (const permission of granted) {
      if (permission === "*") {
        // Full admin wildcard — if any actions were exercised, we still flag it
        // but only if there are granted permissions beyond just "*"
        if (exercised.size === 0) {
          unused.add("*");
        }
        continue;
      }

      if (permission.endsWith(":*")) {
        // Service-level wildcard like "s3:*"
        const servicePrefix = permission.split(":")[0].toLowerCase();
        const hasExercisedInService = [...exercised].some(
          (e) => e.toLowerCase().startsWith(servicePrefix + ":")
        );
        if (!hasExercisedInService) {
          unused.add(permission);
        }
        continue;
      }

      // Exact action match
      const isExercised = [...exercised].some(
        (e) => e.toLowerCase() === permission.toLowerCase()
      );
      if (!isExercised) {
        unused.add(permission);
      }
    }

    return unused;
  }

  private hasExercisedAdminActions(exercised: Set<string>, granted: Set<string>): boolean {
    // If entity has admin access but exercised zero actions, it's high risk
    return exercised.size > 0;
  }

  private async hasLoginProfile(iam: IAMClient, userName: string): Promise<boolean> {
    try {
      await iam.send(new GetLoginProfileCommand({ UserName: userName }));
      return true;
    } catch (err: unknown) {
      const error = err as Error & { name?: string };
      if (error.name === "NoSuchEntityException" || error.name === "NoSuchEntity") {
        return false;
      }
      // If we can't determine, assume they have a login profile
      return true;
    }
  }

  private async checkRoleDependencies(
    iam: IAMClient,
    lambda: LambdaClient,
    ec2: EC2Client,
    ecs: ECSClient,
    entity: IAMEntityInfo,
    recommendation: Recommendation,
    input: PermissionDriftDetectorInput
  ): Promise<void> {
    const dependencies: DependencyInfo[] = [];
    const trustedServices = entity.trustedServices ?? [];

    try {
      // Check Lambda functions using this role
      if (trustedServices.includes("lambda.amazonaws.com")) {
        await this.findLambdaFunctionsUsingRole(lambda, entity.arn, dependencies);
      }

      // Check EC2 instances using this role via instance profiles
      if (trustedServices.includes("ec2.amazonaws.com")) {
        await this.findEc2InstancesUsingRole(iam, ec2, entity.name, dependencies);
      }

      // Check ECS services using this role
      if (trustedServices.includes("ecs-tasks.amazonaws.com") || trustedServices.includes("ecs.amazonaws.com")) {
        await this.findEcsServicesUsingRole(ecs, entity.arn, dependencies);
      }

      // Add trusted service info even if no specific resources found
      for (const svc of trustedServices) {
        const svcName = svc.replace(".amazonaws.com", "");
        const alreadyHasDep = dependencies.some(d => d.resourceType.toLowerCase().includes(svcName.split(".")[0]));
        if (!alreadyHasDep) {
          dependencies.push({
            resourceId: svc,
            resourceType: "AWSService",
            relationship: `Trusted by role via AssumeRolePolicyDocument`,
          });
        }
      }
    } catch (err: unknown) {
      // Dependency check is best-effort; don't fail the recommendation
      console.warn(`Failed to check dependencies for role ${entity.name}:`, err);
    }

    recommendation.dependencies = dependencies;
    if (dependencies.length > 0) {
      recommendation.riskLevel = "High";
    }
  }

  private async findLambdaFunctionsUsingRole(
    lambda: LambdaClient,
    roleArn: string,
    dependencies: DependencyInfo[]
  ): Promise<void> {
    let marker: string | undefined;
    do {
      const response = await lambda.send(new ListFunctionsCommand({ Marker: marker }));
      for (const fn of response.Functions ?? []) {
        if (fn.Role === roleArn) {
          dependencies.push({
            resourceId: fn.FunctionArn ?? fn.FunctionName ?? "unknown",
            resourceType: "LambdaFunction",
            relationship: `Lambda function "${fn.FunctionName}" assumes this role`,
          });
        }
      }
      marker = response.NextMarker;
    } while (marker);
  }

  private async findEc2InstancesUsingRole(
    iam: IAMClient,
    ec2: EC2Client,
    roleName: string,
    dependencies: DependencyInfo[]
  ): Promise<void> {
    // First find instance profiles associated with this role
    const profileResponse = await iam.send(
      new ListInstanceProfilesForRoleCommand({ RoleName: roleName })
    );
    const profileArns = (profileResponse.InstanceProfiles ?? []).map(p => p.Arn).filter(Boolean) as string[];

    if (profileArns.length === 0) return;

    // Find running instances using these instance profiles
    const instanceResponse = await ec2.send(
      new DescribeInstancesCommand({
        Filters: [
          { Name: "iam-instance-profile.arn", Values: profileArns },
          { Name: "instance-state-name", Values: ["running", "stopped"] },
        ],
      })
    );

    for (const reservation of instanceResponse.Reservations ?? []) {
      for (const instance of reservation.Instances ?? []) {
        const nameTag = instance.Tags?.find(t => t.Key === "Name")?.Value;
        dependencies.push({
          resourceId: instance.InstanceId ?? "unknown",
          resourceType: "EC2Instance",
          relationship: `EC2 instance "${nameTag ?? instance.InstanceId}" uses this role via instance profile`,
        });
      }
    }
  }

  private async findEcsServicesUsingRole(
    ecs: ECSClient,
    roleArn: string,
    dependencies: DependencyInfo[]
  ): Promise<void> {
    try {
      const clustersResponse = await ecs.send(new ListClustersCommand({}));
      for (const clusterArn of clustersResponse.clusterArns ?? []) {
        const servicesResponse = await ecs.send(
          new ListServicesCommand({ cluster: clusterArn })
        );
        if (!servicesResponse.serviceArns?.length) continue;

        const descResponse = await ecs.send(
          new DescribeServicesCommand({
            cluster: clusterArn,
            services: servicesResponse.serviceArns,
          })
        );
        for (const svc of descResponse.services ?? []) {
          if (svc.roleArn === roleArn || svc.taskDefinition?.includes(roleArn)) {
            dependencies.push({
              resourceId: svc.serviceArn ?? svc.serviceName ?? "unknown",
              resourceType: "ECSService",
              relationship: `ECS service "${svc.serviceName}" uses this role`,
            });
          }
        }
      }
    } catch {
      // ECS check is best-effort
    }
  }

  private createDriftRecommendation(
    input: PermissionDriftDetectorInput,
    entity: IAMEntityInfo,
    unusedPermissions: Set<string>,
    isHighRisk: boolean
  ): Recommendation {
    const unusedList = [...unusedPermissions].slice(0, 20); // Cap for readability
    const totalUnused = unusedPermissions.size;

    return {
      recommendationId: crypto.randomUUID(),
      scanId: this.scanId,
      accountId: input.accountId,
      region: input.region,
      advisorType: "PermissionDriftDetector",
      resourceId: entity.arn,
      resourceType: entity.type,
      issueDescription: `${entity.type === "IAMUser" ? "User" : "Role"} "${entity.name}" has ${totalUnused} unused permission(s)${entity.hasAdminAccess ? " including admin access" : ""}`,
      suggestedAction: entity.hasAdminAccess
        ? "Remove AdministratorAccess and apply least-privilege policy based on actual usage"
        : "Review and remove unused permissions to follow least-privilege principle",
      riskLevel: isHighRisk ? "High" : "Medium",
      explanation: `Unused permissions: ${unusedList.join(", ")}${totalUnused > 20 ? ` (and ${totalUnused - 20} more)` : ""}. These permissions were granted but not exercised in the last ${input.lookbackDays} days.`,
      estimatedMonthlySavings: null, // IAM has no direct cost
      dependencies: [],
      availableActions: RESOURCE_ACTION_MAP[entity.type],
      createdAt: new Date().toISOString(),
    };
  }

  private createDeactivationRecommendation(
    input: PermissionDriftDetectorInput,
    entity: IAMEntityInfo
  ): Recommendation {
    return {
      recommendationId: crypto.randomUUID(),
      scanId: this.scanId,
      accountId: input.accountId,
      region: input.region,
      advisorType: "PermissionDriftDetector",
      resourceId: entity.arn,
      resourceType: "IAMUser",
      issueDescription: `User "${entity.name}" has no console login and zero API activity in the last ${input.lookbackDays} days`,
      suggestedAction: "Consider deactivating or deleting this IAM user as it appears to be unused",
      riskLevel: entity.hasAdminAccess ? "High" : "Medium",
      explanation: `This user has no login profile and made no API calls during the lookback period. It may be a stale account that should be deactivated to reduce the attack surface.`,
      estimatedMonthlySavings: null,
      dependencies: [],
      availableActions: RESOURCE_ACTION_MAP["IAMUser"],
      createdAt: new Date().toISOString(),
    };
  }
}


// Lambda handler for CDK integration
export async function handler(event: PermissionDriftDetectorInput & { scanId: string }): Promise<PermissionDriftDetectorOutput> {
  const detector = new PermissionDriftDetector(event.scanId);
  return detector.analyze(event);
}
