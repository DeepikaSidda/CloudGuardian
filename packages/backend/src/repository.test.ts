import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import {
  PutCommand,
  GetCommand,
  UpdateCommand,
  QueryCommand,
  BatchWriteCommand,
  ScanCommand,
} from "@aws-sdk/lib-dynamodb";
import { GovernanceDataRepository } from "./repository";
import type {
  ScanRecord,
  Recommendation,
  ResourceAction,
  GovernanceConfig,
} from "@governance-engine/shared";

const ddbMock = mockClient(DynamoDBDocumentClient);

let repo: GovernanceDataRepository;

beforeEach(() => {
  ddbMock.reset();
  repo = new GovernanceDataRepository(
    ddbMock as unknown as DynamoDBDocumentClient
  );
});

const makeScanRecord = (overrides?: Partial<ScanRecord>): ScanRecord => ({
  scanId: "scan-001",
  status: "IN_PROGRESS",
  scanMode: "single-account",
  startTime: "2024-01-01T00:00:00Z",
  resourcesEvaluated: 0,
  recommendationCount: 0,
  accountsScanned: ["111111111111"],
  regionsScanned: ["us-east-1"],
  errors: [],
  ...overrides,
});

const makeRecommendation = (overrides?: Partial<Recommendation>): Recommendation => ({
  recommendationId: "rec-001",
  scanId: "scan-001",
  accountId: "111111111111",
  region: "us-east-1",
  advisorType: "SafeCleanupAdvisor",
  resourceId: "vol-abc123",
  resourceType: "EBSVolume",
  issueDescription: "Unattached EBS volume",
  suggestedAction: "Delete the volume",
  riskLevel: "Low",
  explanation: "Volume has been unattached for 90 days",
  estimatedMonthlySavings: 10,
  dependencies: [],
  availableActions: ["delete"],
  createdAt: "2024-01-01T00:00:00Z",
  ...overrides,
});

const makeAction = (overrides?: Partial<ResourceAction>): ResourceAction => ({
  actionId: "act-001",
  recommendationId: "rec-001",
  userId: "user@example.com",
  accountId: "111111111111",
  region: "us-east-1",
  resourceId: "vol-abc123",
  resourceType: "EBSVolume",
  actionType: "delete",
  status: "PENDING",
  initiatedAt: "2024-01-01T00:00:00Z",
  ...overrides,
});

const makeConfig = (): GovernanceConfig => ({
  scanMode: "single-account",
  scanSchedule: "cron(0 6 * * ? *)",
  lookbackPeriods: {
    safeCleanupAdvisor: 90,
    permissionDriftDetector: 90,
    zombieResourceDetector: 90,
  },
  regions: ["us-east-1"],
  reportConfig: { enabled: true, frequency: "weekly", recipients: ["admin@example.com"] },
  crossAccountRoleName: "GovernanceEngineReadOnlyRole",
});

describe("GovernanceDataRepository", () => {
  describe("Scan Records", () => {
    it("putScanRecord stores a scan with correct PK/SK", async () => {
      ddbMock.on(PutCommand).resolves({});
      const record = makeScanRecord();
      await repo.putScanRecord(record);

      const call = ddbMock.commandCalls(PutCommand)[0];
      expect(call.args[0].input.Item).toMatchObject({
        PK: "SCAN#scan-001",
        SK: "META",
        scanId: "scan-001",
        status: "IN_PROGRESS",
      });
    });

    it("getScanRecord retrieves a scan by scanId", async () => {
      const record = makeScanRecord();
      ddbMock.on(GetCommand).resolves({ Item: { PK: "SCAN#scan-001", SK: "META", ...record } });

      const result = await repo.getScanRecord("scan-001");
      expect(result?.scanId).toBe("scan-001");

      const call = ddbMock.commandCalls(GetCommand)[0];
      expect(call.args[0].input.Key).toEqual({ PK: "SCAN#scan-001", SK: "META" });
    });

    it("getScanRecord returns undefined when not found", async () => {
      ddbMock.on(GetCommand).resolves({});
      const result = await repo.getScanRecord("nonexistent");
      expect(result).toBeUndefined();
    });

    it("updateScanStatus updates status and optional fields", async () => {
      ddbMock.on(UpdateCommand).resolves({});
      await repo.updateScanStatus("scan-001", "COMPLETED", {
        endTime: "2024-01-01T01:00:00Z",
        resourcesEvaluated: 50,
        recommendationCount: 5,
      });

      const call = ddbMock.commandCalls(UpdateCommand)[0];
      const input = call.args[0].input;
      expect(input.Key).toEqual({ PK: "SCAN#scan-001", SK: "META" });
      expect(input.ExpressionAttributeValues).toMatchObject({
        ":st": "COMPLETED",
        ":endTime": "2024-01-01T01:00:00Z",
        ":resEval": 50,
        ":recCount": 5,
      });
    });

    it("getInProgressScan uses DynamoDB Scan with filter", async () => {
      const record = makeScanRecord();
      ddbMock.on(ScanCommand).resolves({ Items: [{ ...record }] });

      const result = await repo.getInProgressScan();
      expect(result?.status).toBe("IN_PROGRESS");

      const call = ddbMock.commandCalls(ScanCommand)[0];
      expect(call.args[0].input.FilterExpression).toContain("#st = :st");
    });

    it("getInProgressScan returns undefined when none found", async () => {
      ddbMock.on(ScanCommand).resolves({ Items: [] });
      const result = await repo.getInProgressScan();
      expect(result).toBeUndefined();
    });
  });

  describe("Recommendations", () => {
    it("putRecommendation stores with correct PK/SK", async () => {
      ddbMock.on(PutCommand).resolves({});
      const rec = makeRecommendation();
      await repo.putRecommendation(rec);

      const call = ddbMock.commandCalls(PutCommand)[0];
      expect(call.args[0].input.Item).toMatchObject({
        PK: "SCAN#scan-001",
        SK: "REC#rec-001",
        advisorType: "SafeCleanupAdvisor",
        riskLevel: "Low",
      });
    });

    it("putRecommendations batches items in groups of 25", async () => {
      ddbMock.on(BatchWriteCommand).resolves({});
      const recs = Array.from({ length: 30 }, (_, i) =>
        makeRecommendation({ recommendationId: `rec-${i}` })
      );
      await repo.putRecommendations(recs);

      const calls = ddbMock.commandCalls(BatchWriteCommand);
      expect(calls).toHaveLength(2);
      const firstBatch = calls[0].args[0].input.RequestItems!["GovernanceData"];
      const secondBatch = calls[1].args[0].input.RequestItems!["GovernanceData"];
      expect(firstBatch).toHaveLength(25);
      expect(secondBatch).toHaveLength(5);
    });

    it("getRecommendation retrieves by scanId and recommendationId", async () => {
      const rec = makeRecommendation();
      ddbMock.on(GetCommand).resolves({ Item: { PK: "SCAN#scan-001", SK: "REC#rec-001", ...rec } });

      const result = await repo.getRecommendation("scan-001", "rec-001");
      expect(result?.recommendationId).toBe("rec-001");
    });

    it("queryRecommendationsByScan returns all recs for a scan", async () => {
      const recs = [makeRecommendation(), makeRecommendation({ recommendationId: "rec-002" })];
      ddbMock.on(QueryCommand).resolves({ Items: recs });

      const result = await repo.queryRecommendationsByScan("scan-001");
      expect(result).toHaveLength(2);

      const call = ddbMock.commandCalls(QueryCommand)[0];
      expect(call.args[0].input.KeyConditionExpression).toContain("begins_with(SK, :skPrefix)");
    });

    it("queryRecommendationsByAdvisor queries GSI1", async () => {
      ddbMock.on(QueryCommand).resolves({ Items: [makeRecommendation()] });
      const result = await repo.queryRecommendationsByAdvisor("SafeCleanupAdvisor");
      expect(result).toHaveLength(1);

      const call = ddbMock.commandCalls(QueryCommand)[0];
      expect(call.args[0].input.IndexName).toBe("GSI1");
    });

    it("queryRecommendationsByAccount queries GSI2", async () => {
      ddbMock.on(QueryCommand).resolves({ Items: [makeRecommendation()] });
      const result = await repo.queryRecommendationsByAccount("111111111111");
      expect(result).toHaveLength(1);

      const call = ddbMock.commandCalls(QueryCommand)[0];
      expect(call.args[0].input.IndexName).toBe("GSI2");
    });

    it("queryRecommendationsByRiskLevel queries GSI3", async () => {
      ddbMock.on(QueryCommand).resolves({ Items: [makeRecommendation()] });
      const result = await repo.queryRecommendationsByRiskLevel("Low");
      expect(result).toHaveLength(1);

      const call = ddbMock.commandCalls(QueryCommand)[0];
      expect(call.args[0].input.IndexName).toBe("GSI3");
    });
  });

  describe("Resource Actions", () => {
    it("putAction stores with correct PK/SK", async () => {
      ddbMock.on(PutCommand).resolves({});
      await repo.putAction(makeAction());

      const call = ddbMock.commandCalls(PutCommand)[0];
      expect(call.args[0].input.Item).toMatchObject({
        PK: "ACTION#act-001",
        SK: "META",
        userId: "user@example.com",
      });
    });

    it("getAction retrieves by actionId", async () => {
      const action = makeAction();
      ddbMock.on(GetCommand).resolves({ Item: { PK: "ACTION#act-001", SK: "META", ...action } });

      const result = await repo.getAction("act-001");
      expect(result?.actionId).toBe("act-001");
    });

    it("queryActionsByUser queries GSI4", async () => {
      ddbMock.on(QueryCommand).resolves({ Items: [makeAction()] });
      const result = await repo.queryActionsByUser("user@example.com");
      expect(result).toHaveLength(1);

      const call = ddbMock.commandCalls(QueryCommand)[0];
      expect(call.args[0].input.IndexName).toBe("GSI4");
    });
  });

  describe("Configuration", () => {
    it("putConfig stores with PK=CONFIG, SK=CURRENT", async () => {
      ddbMock.on(PutCommand).resolves({});
      await repo.putConfig(makeConfig());

      const call = ddbMock.commandCalls(PutCommand)[0];
      expect(call.args[0].input.Item).toMatchObject({
        PK: "CONFIG",
        SK: "CURRENT",
        scanMode: "single-account",
      });
    });

    it("getConfig retrieves current config", async () => {
      const config = makeConfig();
      ddbMock.on(GetCommand).resolves({ Item: { PK: "CONFIG", SK: "CURRENT", ...config } });

      const result = await repo.getConfig();
      expect(result?.scanMode).toBe("single-account");
    });

    it("getConfig returns undefined when no config exists", async () => {
      ddbMock.on(GetCommand).resolves({});
      const result = await repo.getConfig();
      expect(result).toBeUndefined();
    });
  });

  describe("GSI pagination", () => {
    it("handles paginated GSI results", async () => {
      ddbMock
        .on(QueryCommand)
        .resolvesOnce({
          Items: [makeRecommendation({ recommendationId: "rec-1" })],
          LastEvaluatedKey: { PK: "SCAN#scan-001", SK: "REC#rec-1" },
        })
        .resolvesOnce({
          Items: [makeRecommendation({ recommendationId: "rec-2" })],
        });

      const result = await repo.queryRecommendationsByAdvisor("SafeCleanupAdvisor");
      expect(result).toHaveLength(2);
      expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(2);
    });
  });
});
