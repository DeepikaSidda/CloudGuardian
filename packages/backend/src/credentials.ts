import { STSClient, AssumeRoleCommand } from "@aws-sdk/client-sts";

const DEFAULT_ROLE_NAME = "GovernanceEngineReadOnlyRole";

export interface CrossAccountCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
}

const stsClient = new STSClient({});

export async function assumeCrossAccountRole(
  accountId: string,
  roleName: string = DEFAULT_ROLE_NAME
): Promise<CrossAccountCredentials> {
  const roleArn = `arn:aws:iam::${accountId}:role/${roleName}`;
  const sessionName = `GovernanceEngine-${accountId}`;

  const response = await stsClient.send(
    new AssumeRoleCommand({
      RoleArn: roleArn,
      RoleSessionName: sessionName,
    })
  );

  const creds = response.Credentials;
  if (!creds?.AccessKeyId || !creds?.SecretAccessKey || !creds?.SessionToken) {
    throw new Error(`Failed to assume role ${roleArn}: incomplete credentials returned`);
  }

  return {
    accessKeyId: creds.AccessKeyId,
    secretAccessKey: creds.SecretAccessKey,
    sessionToken: creds.SessionToken,
  };
}

export async function getClientForAccount<T>(
  ClientClass: new (config: Record<string, unknown>) => T,
  accountId: string,
  region: string,
  roleName?: string
): Promise<T> {
  if (roleName) {
    const creds = await assumeCrossAccountRole(accountId, roleName);
    return new ClientClass({
      region,
      credentials: {
        accessKeyId: creds.accessKeyId,
        secretAccessKey: creds.secretAccessKey,
        sessionToken: creds.sessionToken,
      },
    });
  }

  return new ClientClass({ region });
}
