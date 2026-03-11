import { mockClient } from "aws-sdk-client-mock";
import { EC2Client, TerminateInstancesCommand, StopInstancesCommand, DeleteVolumeCommand, ReleaseAddressCommand, DeleteSecurityGroupCommand, DeleteNatGatewayCommand } from "@aws-sdk/client-ec2";
import { LambdaClient, DeleteFunctionCommand } from "@aws-sdk/client-lambda";
import { RDSClient, StopDBInstanceCommand, DeleteDBInstanceCommand } from "@aws-sdk/client-rds";
import { ECSClient, UpdateServiceCommand } from "@aws-sdk/client-ecs";
import { ActionExecutor, ActionExecutorInput } from "./action-executor";
import { GovernanceDataRepository } from "./repository";

// Mock the credentials module to avoid STS calls
jest.mock("./credentials", () => ({
  getClientForAccount: jest.fn(async (ClientClass: any, _accountId: string, region: string) => {
    return new ClientClass({ region });
  }),
}));

const ec2Mock = mockClient(EC2Client);
const lambdaMock = mockClient(LambdaClient);
const rdsMock = mockClient(RDSClient);
const ecsMock = mockClient(ECSClient);

// Mock repository
const mockPutAction = jest.fn().mockResolvedValue(undefined);
const mockRepo = { putAction: mockPutAction } as unknown as GovernanceDataRepository;

function makeInput(overrides: Partial<ActionExecutorInput> = {}): ActionExecutorInput {
  return {
    actionId: "action-001",
    userId: "user-123",
    recommendationId: "rec-001",
    accountId: "111111111111",
    region: "us-east-1",
    resourceId: "i-abc123",
    resourceType: "EC2Instance",
    actionType: "terminate",
    ...overrides,
  };
}

beforeEach(() => {
  ec2Mock.reset();
  lambdaMock.reset();
  rdsMock.reset();
  ecsMock.reset();
  mockPutAction.mockClear();
});

describe("ActionExecutor", () => {
  let executor: ActionExecutor;

  beforeEach(() => {
    executor = new ActionExecutor(mockRepo);
  });

  describe("action validation", () => {
    it("rejects invalid action type for resource type", async () => {
      const input = makeInput({ resourceType: "EBSVolume", actionType: "terminate" });
      const result = await executor.execute(input);

      expect(result.status).toBe("FAILED");
      expect(result.error).toContain("not allowed");
      expect(result.error).toContain("terminate");
      expect(result.error).toContain("EBSVolume");
    });

    it("rejects actions on resource types with no allowed actions", async () => {
      const input = makeInput({ resourceType: "IAMUser", actionType: "delete" });
      const result = await executor.execute(input);

      expect(result.status).toBe("FAILED");
      expect(result.error).toContain("not allowed");
    });
  });

  describe("dependency acknowledgment", () => {
    it("rejects action on resource with dependencies when acknowledgment not provided", async () => {
      const input = makeInput({
        dependencies: [{ resourceId: "snap-123", resourceType: "EBSSnapshot", relationship: "snapshot references volume" }],
        dependencyAcknowledgment: false,
      });
      const result = await executor.execute(input);

      expect(result.status).toBe("FAILED");
      expect(result.error).toContain("dependency acknowledgment");
    });

    it("allows action on resource with dependencies when acknowledgment is provided", async () => {
      ec2Mock.on(TerminateInstancesCommand).resolves({});
      const input = makeInput({
        dependencies: [{ resourceId: "snap-123", resourceType: "EBSSnapshot", relationship: "snapshot references volume" }],
        dependencyAcknowledgment: true,
      });
      const result = await executor.execute(input);

      expect(result.status).toBe("SUCCESS");
    });

    it("allows action on resource without dependencies regardless of acknowledgment flag", async () => {
      ec2Mock.on(TerminateInstancesCommand).resolves({});
      const input = makeInput({ dependencies: [] });
      const result = await executor.execute(input);

      expect(result.status).toBe("SUCCESS");
    });
  });

  describe("EC2 actions", () => {
    it("successfully terminates an EC2 instance", async () => {
      ec2Mock.on(TerminateInstancesCommand).resolves({});
      const input = makeInput({ actionType: "terminate" });
      const result = await executor.execute(input);

      expect(result.status).toBe("SUCCESS");
      expect(result.actionId).toBe("action-001");
      expect(result.timestamp).toBeDefined();
      expect(result.error).toBeUndefined();
    });

    it("successfully stops an EC2 instance", async () => {
      ec2Mock.on(StopInstancesCommand).resolves({});
      const input = makeInput({ actionType: "stop" });
      const result = await executor.execute(input);

      expect(result.status).toBe("SUCCESS");
    });
  });

  describe("EBS actions", () => {
    it("successfully deletes an EBS volume", async () => {
      ec2Mock.on(DeleteVolumeCommand).resolves({});
      const input = makeInput({ resourceType: "EBSVolume", resourceId: "vol-abc123", actionType: "delete" });
      const result = await executor.execute(input);

      expect(result.status).toBe("SUCCESS");
    });
  });

  describe("Elastic IP actions", () => {
    it("successfully releases an Elastic IP", async () => {
      ec2Mock.on(ReleaseAddressCommand).resolves({});
      const input = makeInput({ resourceType: "ElasticIP", resourceId: "eipalloc-abc123", actionType: "release" });
      const result = await executor.execute(input);

      expect(result.status).toBe("SUCCESS");
    });
  });

  describe("Lambda actions", () => {
    it("successfully deletes a Lambda function", async () => {
      lambdaMock.on(DeleteFunctionCommand).resolves({});
      const input = makeInput({ resourceType: "LambdaFunction", resourceId: "my-function", actionType: "delete" });
      const result = await executor.execute(input);

      expect(result.status).toBe("SUCCESS");
    });
  });

  describe("RDS actions", () => {
    it("successfully stops an RDS instance", async () => {
      rdsMock.on(StopDBInstanceCommand).resolves({});
      const input = makeInput({ resourceType: "RDSInstance", resourceId: "my-db", actionType: "stop" });
      const result = await executor.execute(input);

      expect(result.status).toBe("SUCCESS");
    });

    it("successfully deletes an RDS instance with SkipFinalSnapshot", async () => {
      rdsMock.on(DeleteDBInstanceCommand).resolves({});
      const input = makeInput({ resourceType: "RDSInstance", resourceId: "my-db", actionType: "delete" });
      const result = await executor.execute(input);

      expect(result.status).toBe("SUCCESS");
    });
  });

  describe("ECS actions", () => {
    it("successfully stops an ECS service by setting desiredCount to 0", async () => {
      ecsMock.on(UpdateServiceCommand).resolves({});
      const input = makeInput({ resourceType: "ECSService", resourceId: "my-cluster/my-service", actionType: "stop" });
      const result = await executor.execute(input);

      expect(result.status).toBe("SUCCESS");
    });
  });

  describe("Security Group actions", () => {
    it("successfully deletes a security group", async () => {
      ec2Mock.on(DeleteSecurityGroupCommand).resolves({});
      const input = makeInput({ resourceType: "SecurityGroup", resourceId: "sg-abc123", actionType: "delete" });
      const result = await executor.execute(input);

      expect(result.status).toBe("SUCCESS");
    });
  });

  describe("NAT Gateway actions", () => {
    it("successfully deletes a NAT gateway", async () => {
      ec2Mock.on(DeleteNatGatewayCommand).resolves({});
      const input = makeInput({ resourceType: "NATGateway", resourceId: "nat-abc123", actionType: "delete" });
      const result = await executor.execute(input);

      expect(result.status).toBe("SUCCESS");
    });
  });

  describe("error handling", () => {
    it("returns FAILED with error details when AWS API throws", async () => {
      ec2Mock.on(TerminateInstancesCommand).rejects(new Error("Insufficient permissions"));
      const input = makeInput();
      const result = await executor.execute(input);

      expect(result.status).toBe("FAILED");
      expect(result.error).toBe("Insufficient permissions");
    });
  });

  describe("action logging", () => {
    it("logs successful action with all required fields", async () => {
      ec2Mock.on(TerminateInstancesCommand).resolves({});
      const input = makeInput();
      await executor.execute(input);

      expect(mockPutAction).toHaveBeenCalledTimes(1);
      const logged = mockPutAction.mock.calls[0][0];
      expect(logged.actionId).toBe("action-001");
      expect(logged.userId).toBe("user-123");
      expect(logged.resourceId).toBe("i-abc123");
      expect(logged.resourceType).toBe("EC2Instance");
      expect(logged.actionType).toBe("terminate");
      expect(logged.status).toBe("SUCCESS");
      expect(logged.initiatedAt).toBeDefined();
      expect(logged.completedAt).toBeDefined();
      expect(logged.result).toContain("Successfully executed");
    });

    it("logs failed action with error details", async () => {
      ec2Mock.on(TerminateInstancesCommand).rejects(new Error("Access denied"));
      const input = makeInput();
      await executor.execute(input);

      expect(mockPutAction).toHaveBeenCalledTimes(1);
      const logged = mockPutAction.mock.calls[0][0];
      expect(logged.status).toBe("FAILED");
      expect(logged.result).toBe("Access denied");
    });

    it("still returns result even if logging fails", async () => {
      ec2Mock.on(TerminateInstancesCommand).resolves({});
      mockPutAction.mockRejectedValueOnce(new Error("DynamoDB error"));
      const input = makeInput();
      const result = await executor.execute(input);

      expect(result.status).toBe("SUCCESS");
    });
  });
});
