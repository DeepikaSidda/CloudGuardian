import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { GovernanceDataRepository } from "../repository";
import { validatePolicy } from "@governance-engine/shared";
import type { GovernancePolicy } from "@governance-engine/shared";

const repository = new GovernanceDataRepository();

const CORS_HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Amz-Date,X-Api-Key",
};

function jsonResponse(statusCode: number, body: unknown): APIGatewayProxyResult {
  return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(body) };
}

export async function handleCreatePolicy(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const body = JSON.parse(event.body ?? "{}");

  const validation = validatePolicy(body);
  if (!validation.valid) {
    return jsonResponse(400, { errors: validation.errors });
  }

  const now = new Date().toISOString();
  const policy: GovernancePolicy = {
    policyId: crypto.randomUUID(),
    name: body.name,
    description: body.description ?? "",
    enabled: body.enabled !== undefined ? body.enabled : true,
    resourceType: body.resourceType,
    condition: body.condition,
    severity: body.severity ?? "Medium",
    createdAt: now,
    updatedAt: now,
  };

  await repository.putPolicy(policy);
  return jsonResponse(201, policy);
}

export async function handleListPolicies(): Promise<APIGatewayProxyResult> {
  const policies = await repository.listPolicies();
  return jsonResponse(200, policies);
}

export async function handleGetPolicy(policyId: string): Promise<APIGatewayProxyResult> {
  const policy = await repository.getPolicy(policyId);
  if (!policy) {
    return jsonResponse(404, { message: "Policy not found" });
  }
  return jsonResponse(200, policy);
}

export async function handleUpdatePolicy(event: APIGatewayProxyEvent, policyId: string): Promise<APIGatewayProxyResult> {
  const body = JSON.parse(event.body ?? "{}");

  const existing = await repository.getPolicy(policyId);
  if (!existing) {
    return jsonResponse(404, { message: "Policy not found" });
  }

  const merged: GovernancePolicy = {
    ...existing,
    ...body,
    policyId: existing.policyId,
    createdAt: existing.createdAt,
    updatedAt: new Date().toISOString(),
  };

  const validation = validatePolicy(merged);
  if (!validation.valid) {
    return jsonResponse(400, { errors: validation.errors });
  }

  await repository.putPolicy(merged);
  return jsonResponse(200, merged);
}

export async function handleDeletePolicy(policyId: string): Promise<APIGatewayProxyResult> {
  await repository.deletePolicy(policyId);
  return jsonResponse(200, { message: "Policy deleted" });
}
