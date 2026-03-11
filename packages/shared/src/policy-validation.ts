import { GovernancePolicy, ConditionOperator, ResourceType } from "./types";
import { ValidationResult } from "./validation";

const VALID_OPERATORS: readonly ConditionOperator[] = [
  "equals", "not_equals", "greater_than", "less_than",
  "in", "not_in", "contains", "not_contains", "exists", "not_exists",
];

const VALID_RESOURCE_TYPES: readonly ResourceType[] = [
  "EC2Instance", "EBSVolume", "S3Bucket", "ElasticIP", "LoadBalancer",
  "SecurityGroup", "IAMUser", "IAMRole", "LambdaFunction",
  "RDSInstance", "ECSService", "ECSCluster", "NATGateway", "CloudWatchLogGroup",
  "VPC", "Subnet", "SNSTopic", "SQSQueue", "DynamoDBTable",
  "CloudFrontDistribution", "AutoScalingGroup",
];

export function validatePolicy(policy: Partial<GovernancePolicy>): ValidationResult {
  const errors: string[] = [];

  // Validate name
  if (!policy.name || typeof policy.name !== "string" || policy.name.trim().length === 0) {
    errors.push("name is required and must be a non-empty string");
  }

  // Validate resourceType
  if (!policy.resourceType || !(VALID_RESOURCE_TYPES as readonly string[]).includes(policy.resourceType)) {
    errors.push(
      `Invalid resourceType "${policy.resourceType ?? ""}". Must be one of: ${VALID_RESOURCE_TYPES.join(", ")}`
    );
  }

  // Validate condition
  if (!policy.condition) {
    errors.push("condition is required");
  } else {
    if (!policy.condition.property || typeof policy.condition.property !== "string" || policy.condition.property.trim().length === 0) {
      errors.push("condition.property is required and must be a non-empty string");
    }

    if (!policy.condition.operator || !(VALID_OPERATORS as readonly string[]).includes(policy.condition.operator)) {
      errors.push(
        `Invalid condition.operator "${policy.condition.operator ?? ""}". Must be one of: ${VALID_OPERATORS.join(", ")}`
      );
    } else {
      // Validate operator-value type constraints
      const op = policy.condition.operator;
      if ((op === "greater_than" || op === "less_than") && typeof policy.condition.value !== "number") {
        errors.push(`condition.value must be a number when operator is "${op}"`);
      }
      if ((op === "in" || op === "not_in") && !Array.isArray(policy.condition.value)) {
        errors.push(`condition.value must be an array when operator is "${op}"`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}
