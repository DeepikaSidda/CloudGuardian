import { mockClient } from "aws-sdk-client-mock";
import { STSClient, AssumeRoleCommand } from "@aws-sdk/client-sts";
import { assumeCrossAccountRole, getClientForAccount } from "./credentials";

const stsMock = mockClient(STSClient);

beforeEach(() => {
  stsMock.reset();
});

describe("assumeCrossAccountRole", () => {
  it("returns temporary credentials for a given account and role", async () => {
    stsMock.on(AssumeRoleCommand).resolves({
      Credentials: {
        AccessKeyId: "AKID",
        SecretAccessKey: "SECRET",
        SessionToken: "TOKEN",
        Expiration: new Date(),
      },
    });

    const creds = await assumeCrossAccountRole("123456789012", "MyRole");

    expect(creds).toEqual({
      accessKeyId: "AKID",
      secretAccessKey: "SECRET",
      sessionToken: "TOKEN",
    });

    const call = stsMock.commandCalls(AssumeRoleCommand)[0];
    expect(call.args[0].input).toEqual({
      RoleArn: "arn:aws:iam::123456789012:role/MyRole",
      RoleSessionName: "GovernanceEngine-123456789012",
    });
  });

  it("uses default role name when none provided", async () => {
    stsMock.on(AssumeRoleCommand).resolves({
      Credentials: {
        AccessKeyId: "AKID",
        SecretAccessKey: "SECRET",
        SessionToken: "TOKEN",
        Expiration: new Date(),
      },
    });

    await assumeCrossAccountRole("111222333444");

    const call = stsMock.commandCalls(AssumeRoleCommand)[0];
    expect(call.args[0].input.RoleArn).toBe(
      "arn:aws:iam::111222333444:role/GovernanceEngineReadOnlyRole"
    );
  });

  it("throws when credentials are incomplete", async () => {
    stsMock.on(AssumeRoleCommand).resolves({
      Credentials: {
        AccessKeyId: "AKID",
        SecretAccessKey: undefined as unknown as string,
        SessionToken: "TOKEN",
        Expiration: new Date(),
      },
    });

    await expect(
      assumeCrossAccountRole("123456789012")
    ).rejects.toThrow("Failed to assume role");
  });
});

describe("getClientForAccount", () => {
  class FakeClient {
    config: Record<string, unknown>;
    constructor(config: Record<string, unknown>) {
      this.config = config;
    }
  }

  it("creates client with assumed role credentials when roleName provided", async () => {
    stsMock.on(AssumeRoleCommand).resolves({
      Credentials: {
        AccessKeyId: "AKID",
        SecretAccessKey: "SECRET",
        SessionToken: "TOKEN",
        Expiration: new Date(),
      },
    });

    const client = await getClientForAccount(
      FakeClient,
      "123456789012",
      "us-east-1",
      "CrossRole"
    );

    expect(client).toBeInstanceOf(FakeClient);
    expect(client.config).toEqual({
      region: "us-east-1",
      credentials: {
        accessKeyId: "AKID",
        secretAccessKey: "SECRET",
        sessionToken: "TOKEN",
      },
    });
  });

  it("creates client with default credentials when no roleName", async () => {
    const client = await getClientForAccount(
      FakeClient,
      "123456789012",
      "eu-west-1"
    );

    expect(client).toBeInstanceOf(FakeClient);
    expect(client.config).toEqual({ region: "eu-west-1" });
    expect(stsMock.commandCalls(AssumeRoleCommand)).toHaveLength(0);
  });
});
