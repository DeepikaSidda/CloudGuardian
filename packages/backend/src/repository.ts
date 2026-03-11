import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  UpdateCommand,
  QueryCommand,
  BatchWriteCommand,
  ScanCommand,
  DeleteCommand,
} from "@aws-sdk/lib-dynamodb";
import type {
  ScanRecord,
  ScanStatus,
  Recommendation,
  ResourceAction,
  GovernanceConfig,
  GovernancePolicy,
  ResourceNode,
  DependencyEdge,
} from "@governance-engine/shared";

const TABLE_NAME = process.env.TABLE_NAME ?? "GovernanceData";

export class GovernanceDataRepository {
  private readonly docClient: DynamoDBDocumentClient;
  private readonly tableName: string;

  constructor(docClient?: DynamoDBDocumentClient) {
    this.tableName = TABLE_NAME;
    if (docClient) {
      this.docClient = docClient;
    } else {
      const client = new DynamoDBClient({});
      this.docClient = DynamoDBDocumentClient.from(client, {
        marshallOptions: { removeUndefinedValues: true },
      });
    }
  }

  // --- Scan Records ---

  async putScanRecord(record: ScanRecord): Promise<void> {
    await this.docClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          PK: `SCAN#${record.scanId}`,
          SK: "META",
          ...record,
        },
      })
    );
  }

  async getScanRecord(scanId: string): Promise<ScanRecord | undefined> {
    const result = await this.docClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { PK: `SCAN#${scanId}`, SK: "META" },
      })
    );
    return result.Item as ScanRecord | undefined;
  }

  async updateScanStatus(
    scanId: string,
    status: ScanStatus,
    updates?: Partial<Pick<ScanRecord, "endTime" | "resourcesEvaluated" | "recommendationCount" | "errors">>
  ): Promise<void> {
    const expressionParts: string[] = ["#st = :st"];
    const names: Record<string, string> = { "#st": "status" };
    const values: Record<string, unknown> = { ":st": status };

    if (updates?.endTime !== undefined) {
      expressionParts.push("endTime = :endTime");
      values[":endTime"] = updates.endTime;
    }
    if (updates?.resourcesEvaluated !== undefined) {
      expressionParts.push("resourcesEvaluated = :resEval");
      values[":resEval"] = updates.resourcesEvaluated;
    }
    if (updates?.recommendationCount !== undefined) {
      expressionParts.push("recommendationCount = :recCount");
      values[":recCount"] = updates.recommendationCount;
    }
    if (updates?.errors !== undefined) {
      expressionParts.push("errors = :errors");
      values[":errors"] = updates.errors;
    }

    await this.docClient.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { PK: `SCAN#${scanId}`, SK: "META" },
        UpdateExpression: `SET ${expressionParts.join(", ")}`,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
      })
    );
  }

  async getInProgressScan(): Promise<ScanRecord | undefined> {
    const result = await this.docClient.send(
      new ScanCommand({
        TableName: this.tableName,
        FilterExpression: "SK = :sk AND #st = :st",
        ExpressionAttributeNames: { "#st": "status" },
        ExpressionAttributeValues: { ":sk": "META", ":st": "IN_PROGRESS" },
        Limit: 1,
      })
    );
    return result.Items?.[0] as ScanRecord | undefined;
  }

  async listScans(): Promise<ScanRecord[]> {
    const items: ScanRecord[] = [];
    let exclusiveStartKey: Record<string, unknown> | undefined;

    do {
      const result = await this.docClient.send(
        new ScanCommand({
          TableName: this.tableName,
          FilterExpression: "SK = :sk",
          ExpressionAttributeValues: { ":sk": "META" },
          ExclusiveStartKey: exclusiveStartKey,
        })
      );
      const scans = (result.Items ?? []).filter(
        (item) => (item as Record<string, unknown>).PK?.toString().startsWith("SCAN#")
      ) as ScanRecord[];
      items.push(...scans);
      exclusiveStartKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (exclusiveStartKey);

    return items;
  }


  // --- Recommendations ---

  async putRecommendation(rec: Recommendation): Promise<void> {
    await this.docClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          PK: `SCAN#${rec.scanId}`,
          SK: `REC#${rec.recommendationId}`,
          ...rec,
        },
      })
    );
  }

  async putRecommendations(recs: Recommendation[]): Promise<void> {
    // DynamoDB BatchWriteItem supports max 25 items per request
    const chunks = chunkArray(recs, 25);
    for (const chunk of chunks) {
      await this.docClient.send(
        new BatchWriteCommand({
          RequestItems: {
            [this.tableName]: chunk.map((rec) => ({
              PutRequest: {
                Item: {
                  PK: `SCAN#${rec.scanId}`,
                  SK: `REC#${rec.recommendationId}`,
                  ...rec,
                },
              },
            })),
          },
        })
      );
    }
  }

  async getRecommendation(scanId: string, recommendationId: string): Promise<Recommendation | undefined> {
    const result = await this.docClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { PK: `SCAN#${scanId}`, SK: `REC#${recommendationId}` },
      })
    );
    return result.Item as Recommendation | undefined;
  }

  async queryRecommendationsByScan(scanId: string): Promise<Recommendation[]> {
    const result = await this.docClient.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :skPrefix)",
        ExpressionAttributeValues: { ":pk": `SCAN#${scanId}`, ":skPrefix": "REC#" },
      })
    );
    return (result.Items ?? []) as Recommendation[];
  }

  async queryRecommendationsByAdvisor(advisorType: string): Promise<Recommendation[]> {
    return this.queryGSI("GSI1", "advisorType", advisorType);
  }

  async queryRecommendationsByAccount(accountId: string): Promise<Recommendation[]> {
    return this.queryGSI("GSI2", "accountId", accountId);
  }

  async queryRecommendationsByRiskLevel(riskLevel: string): Promise<Recommendation[]> {
    return this.queryGSI("GSI3", "riskLevel", riskLevel);
  }

  // --- Resource Actions ---

  async putAction(action: ResourceAction): Promise<void> {
    await this.docClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          PK: `ACTION#${action.actionId}`,
          SK: "META",
          ...action,
        },
      })
    );
  }

  async getAction(actionId: string): Promise<ResourceAction | undefined> {
    const result = await this.docClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { PK: `ACTION#${actionId}`, SK: "META" },
      })
    );
    return result.Item as ResourceAction | undefined;
  }

  async queryActionsByUser(userId: string): Promise<ResourceAction[]> {
    const result = await this.docClient.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: "GSI4",
        KeyConditionExpression: "userId = :userId",
        ExpressionAttributeValues: { ":userId": userId },
      })
    );
    return (result.Items ?? []) as ResourceAction[];
  }

  async listActions(): Promise<ResourceAction[]> {
    const items: ResourceAction[] = [];
    let exclusiveStartKey: Record<string, unknown> | undefined;

    do {
      const result = await this.docClient.send(
        new ScanCommand({
          TableName: this.tableName,
          FilterExpression: "SK = :sk",
          ExpressionAttributeValues: { ":sk": "META" },
          ExclusiveStartKey: exclusiveStartKey,
        })
      );
      const actions = (result.Items ?? []).filter(
        (item) => (item as Record<string, unknown>).PK?.toString().startsWith("ACTION#")
      ) as ResourceAction[];
      items.push(...actions);
      exclusiveStartKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (exclusiveStartKey);

    return items;
  }

  // --- Configuration ---

  async getConfig(): Promise<GovernanceConfig | undefined> {
    const result = await this.docClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { PK: "CONFIG", SK: "CURRENT" },
      })
    );
    return result.Item as GovernanceConfig | undefined;
  }

  async putConfig(config: GovernanceConfig): Promise<void> {
    await this.docClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          PK: "CONFIG",
          SK: "CURRENT",
          ...config,
        },
      })
    );
  }

  // --- Chat Sessions ---

  async putChatSession(session: { id: string; title: string; messages: unknown[]; createdAt: string; updatedAt: string }): Promise<void> {
    await this.docClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          PK: `CHAT#${session.id}`,
          SK: "META",
          ...session,
        },
      })
    );
  }

  async getChatSession(chatId: string): Promise<unknown | undefined> {
    const result = await this.docClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { PK: `CHAT#${chatId}`, SK: "META" },
      })
    );
    return result.Item;
  }

  async listChatSessions(): Promise<unknown[]> {
    const items: unknown[] = [];
    let exclusiveStartKey: Record<string, unknown> | undefined;
    do {
      const result = await this.docClient.send(
        new ScanCommand({
          TableName: this.tableName,
          FilterExpression: "SK = :sk AND begins_with(PK, :prefix)",
          ExpressionAttributeValues: { ":sk": "META", ":prefix": "CHAT#" },
          ExclusiveStartKey: exclusiveStartKey,
        })
      );
      items.push(...(result.Items ?? []));
      exclusiveStartKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (exclusiveStartKey);
    return items;
  }

  async deleteChatSession(chatId: string): Promise<void> {
    await this.docClient.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: { PK: `CHAT#${chatId}`, SK: "META" },
      })
    );
  }

  // --- Settings (generic key-value store) ---

  async putSetting(key: string, value: unknown): Promise<void> {
    await this.docClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          PK: `SETTING#${key}`,
          SK: "VALUE",
          key,
          value,
          updatedAt: new Date().toISOString(),
        },
      })
    );
  }

  async getSetting(key: string): Promise<unknown | undefined> {
    const result = await this.docClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { PK: `SETTING#${key}`, SK: "VALUE" },
      })
    );
    return result.Item?.value;
  }

  async deleteSetting(key: string): Promise<void> {
    await this.docClient.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: { PK: `SETTING#${key}`, SK: "VALUE" },
      })
    );
  }


  // --- Dependency Graph ---

  async putGraphNodes(scanId: string, nodes: ResourceNode[]): Promise<void> {
    if (nodes.length === 0) return;
    const chunks = chunkArray(nodes, 25);
    for (const chunk of chunks) {
      await this.docClient.send(
        new BatchWriteCommand({
          RequestItems: {
            [this.tableName]: chunk.map((node) => ({
              PutRequest: {
                Item: {
                  PK: `GRAPH#${scanId}`,
                  SK: `NODE#${node.resourceId}`,
                  ...node,
                },
              },
            })),
          },
        })
      );
    }
  }

  async putGraphEdges(scanId: string, edges: DependencyEdge[]): Promise<void> {
    if (edges.length === 0) return;
    const chunks = chunkArray(edges, 25);
    for (const chunk of chunks) {
      await this.docClient.send(
        new BatchWriteCommand({
          RequestItems: {
            [this.tableName]: chunk.map((edge) => ({
              PutRequest: {
                Item: {
                  PK: `GRAPH#${scanId}`,
                  SK: `EDGE#${edge.sourceResourceId}#${edge.targetResourceId}`,
                  ...edge,
                },
              },
            })),
          },
        })
      );
    }
  }

  async putGraphMeta(accountId: string, region: string, scanId: string): Promise<void> {
    await this.docClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          PK: `GRAPHMETA#${accountId}#${region}`,
          SK: "LATEST",
          scanId,
          accountId,
          region,
        },
      })
    );
  }

  async getGraph(scanId: string): Promise<{ nodes: ResourceNode[]; edges: DependencyEdge[] }> {
    const nodes: ResourceNode[] = [];
    const edges: DependencyEdge[] = [];
    let exclusiveStartKey: Record<string, unknown> | undefined;

    do {
      const result = await this.docClient.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: "PK = :pk",
          ExpressionAttributeValues: { ":pk": `GRAPH#${scanId}` },
          ExclusiveStartKey: exclusiveStartKey,
        })
      );

      for (const item of result.Items ?? []) {
        const sk = item.SK as string;
        if (sk.startsWith("NODE#")) {
          nodes.push({
            resourceId: item.resourceId as string,
            resourceType: item.resourceType as ResourceNode["resourceType"],
            accountId: item.accountId as string,
            region: item.region as string,
            displayName: item.displayName as string,
          });
        } else if (sk.startsWith("EDGE#")) {
          edges.push({
            sourceResourceId: item.sourceResourceId as string,
            targetResourceId: item.targetResourceId as string,
            relationshipLabel: item.relationshipLabel as string,
          });
        }
      }

      exclusiveStartKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (exclusiveStartKey);

    return { nodes, edges };
  }

  async getSubgraph(
    scanId: string,
    resourceId: string,
    depth: number
  ): Promise<{ nodes: ResourceNode[]; edges: DependencyEdge[] }> {
    const { nodes: allNodes, edges: allEdges } = await this.getGraph(scanId);

    // Build adjacency map (undirected for BFS traversal)
    const adjacency = new Map<string, Set<string>>();
    for (const edge of allEdges) {
      if (!adjacency.has(edge.sourceResourceId)) {
        adjacency.set(edge.sourceResourceId, new Set());
      }
      if (!adjacency.has(edge.targetResourceId)) {
        adjacency.set(edge.targetResourceId, new Set());
      }
      adjacency.get(edge.sourceResourceId)!.add(edge.targetResourceId);
      adjacency.get(edge.targetResourceId)!.add(edge.sourceResourceId);
    }

    // BFS up to `depth` hops
    const visited = new Set<string>();
    let frontier = [resourceId];
    visited.add(resourceId);

    for (let d = 0; d < depth && frontier.length > 0; d++) {
      const nextFrontier: string[] = [];
      for (const nodeId of frontier) {
        for (const neighbor of adjacency.get(nodeId) ?? []) {
          if (!visited.has(neighbor)) {
            visited.add(neighbor);
            nextFrontier.push(neighbor);
          }
        }
      }
      frontier = nextFrontier;
    }

    const subNodes = allNodes.filter((n) => visited.has(n.resourceId));
    const subEdges = allEdges.filter(
      (e) => visited.has(e.sourceResourceId) && visited.has(e.targetResourceId)
    );

    return { nodes: subNodes, edges: subEdges };
  }

  async getLatestGraphScanId(accountId: string, region: string): Promise<string | undefined> {
    const result = await this.docClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          PK: `GRAPHMETA#${accountId}#${region}`,
          SK: "LATEST",
        },
      })
    );
    return result.Item?.scanId as string | undefined;
  }

  async deleteGraph(scanId: string): Promise<void> {
    let exclusiveStartKey: Record<string, unknown> | undefined;

    do {
      const result = await this.docClient.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: "PK = :pk",
          ExpressionAttributeValues: { ":pk": `GRAPH#${scanId}` },
          ProjectionExpression: "PK, SK",
          ExclusiveStartKey: exclusiveStartKey,
        })
      );

      const items = result.Items ?? [];
      if (items.length > 0) {
        const chunks = chunkArray(items, 25);
        for (const chunk of chunks) {
          await this.docClient.send(
            new BatchWriteCommand({
              RequestItems: {
                [this.tableName]: chunk.map((item) => ({
                  DeleteRequest: {
                    Key: { PK: item.PK, SK: item.SK },
                  },
                })),
              },
            })
          );
        }
      }

      exclusiveStartKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (exclusiveStartKey);
  }

  // --- Policies ---

  async putPolicy(policy: GovernancePolicy): Promise<void> {
    await this.docClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          PK: `POLICY#${policy.policyId}`,
          SK: "POLICY",
          ...policy,
        },
      })
    );
  }

  async getPolicy(policyId: string): Promise<GovernancePolicy | undefined> {
    const result = await this.docClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { PK: `POLICY#${policyId}`, SK: "POLICY" },
      })
    );
    return result.Item as GovernancePolicy | undefined;
  }

  async listPolicies(): Promise<GovernancePolicy[]> {
    const items: GovernancePolicy[] = [];
    let exclusiveStartKey: Record<string, unknown> | undefined;

    do {
      const result = await this.docClient.send(
        new ScanCommand({
          TableName: this.tableName,
          FilterExpression: "begins_with(PK, :pk) AND SK = :sk",
          ExpressionAttributeValues: { ":pk": "POLICY#", ":sk": "POLICY" },
          ExclusiveStartKey: exclusiveStartKey,
        })
      );
      items.push(...((result.Items ?? []) as GovernancePolicy[]));
      exclusiveStartKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (exclusiveStartKey);

    return items;
  }

  async deletePolicy(policyId: string): Promise<void> {
    await this.docClient.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: { PK: `POLICY#${policyId}`, SK: "POLICY" },
      })
    );
  }

  // --- Billing Cache ---

  async getBillingCache(): Promise<{ data: any; timestamp: number } | undefined> {
    const result = await this.docClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { PK: "BILLING_CACHE", SK: "LATEST" },
      })
    );
    if (!result.Item) return undefined;
    return { data: result.Item.data, timestamp: result.Item.timestamp as number };
  }

  async putBillingCache(data: any): Promise<void> {
    await this.docClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          PK: "BILLING_CACHE",
          SK: "LATEST",
          data,
          timestamp: Date.now(),
        },
      })
    );
  }

  // --- Scan + Recommendation Deletion ---

  async deleteScanAndRecommendations(scanId: string): Promise<void> {
    // Query all items under SCAN#scanId (META + all REC# items)
    let exclusiveStartKey: Record<string, unknown> | undefined;
    do {
      const result = await this.docClient.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: "PK = :pk",
          ExpressionAttributeValues: { ":pk": `SCAN#${scanId}` },
          ProjectionExpression: "PK, SK",
          ExclusiveStartKey: exclusiveStartKey,
        })
      );
      const items = result.Items ?? [];
      if (items.length > 0) {
        const chunks = chunkArray(items, 25);
        for (const chunk of chunks) {
          await this.docClient.send(
            new BatchWriteCommand({
              RequestItems: {
                [this.tableName]: chunk.map((item) => ({
                  DeleteRequest: { Key: { PK: item.PK, SK: item.SK } },
                })),
              },
            })
          );
        }
      }
      exclusiveStartKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (exclusiveStartKey);
  }

  // --- Private Helpers ---

  private async queryGSI(indexName: string, pkField: string, pkValue: string): Promise<Recommendation[]> {
    const items: Recommendation[] = [];
    let exclusiveStartKey: Record<string, unknown> | undefined;

    do {
      const result = await this.docClient.send(
        new QueryCommand({
          TableName: this.tableName,
          IndexName: indexName,
          KeyConditionExpression: `${pkField} = :pkVal`,
          ExpressionAttributeValues: { ":pkVal": pkValue },
          ExclusiveStartKey: exclusiveStartKey,
        })
      );
      items.push(...((result.Items ?? []) as Recommendation[]));
      exclusiveStartKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (exclusiveStartKey);

    return items;
  }
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}
