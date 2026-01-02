import {
  GetSecretValueCommand,
  PutSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";

export interface GoogleCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  accessToken?: string;
  expiryDate?: number;
}

// In-memory cache to avoid repeated Secrets Manager calls
let cachedCredentials: GoogleCredentials | null = null;
let cacheTimestamp: number = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

const client = new SecretsManagerClient({});

/**
 * Get the secret name from environment variable
 */
function getSecretName(): string {
  const secretName = process.env.SECRET_NAME;
  if (!secretName) {
    throw new Error("SECRET_NAME environment variable is not set");
  }
  return secretName;
}

/**
 * Retrieve Google OAuth credentials from AWS Secrets Manager
 * Uses in-memory caching to reduce API calls
 */
export async function getCredentials(): Promise<GoogleCredentials> {
  const now = Date.now();

  // Return cached credentials if still valid
  if (cachedCredentials && now - cacheTimestamp < CACHE_TTL_MS) {
    console.log("Using cached credentials");
    return cachedCredentials;
  }

  console.log("Fetching credentials from Secrets Manager");
  const secretName = getSecretName();

  const command = new GetSecretValueCommand({
    SecretId: secretName,
  });

  const response = await client.send(command);

  if (!response.SecretString) {
    throw new Error("Secret value is empty");
  }

  const credentials = JSON.parse(response.SecretString) as GoogleCredentials;

  // Validate required fields
  if (
    !credentials.clientId ||
    !credentials.clientSecret ||
    !credentials.refreshToken
  ) {
    throw new Error(
      "Invalid credentials: missing clientId, clientSecret, or refreshToken",
    );
  }

  // Update cache
  cachedCredentials = credentials;
  cacheTimestamp = now;

  console.log("Credentials loaded successfully");
  return credentials;
}

/**
 * Update Google OAuth credentials in AWS Secrets Manager
 * Called when tokens are refreshed
 */
export async function updateCredentials(
  credentials: GoogleCredentials,
): Promise<void> {
  console.log("Updating credentials in Secrets Manager");
  const secretName = getSecretName();

  const command = new PutSecretValueCommand({
    SecretId: secretName,
    SecretString: JSON.stringify(credentials),
  });

  await client.send(command);

  // Update cache with new credentials
  cachedCredentials = credentials;
  cacheTimestamp = Date.now();

  console.log("Credentials updated successfully");
}

/**
 * Clear the credentials cache
 * Useful for testing or when credentials need to be refreshed
 */
export function clearCache(): void {
  cachedCredentials = null;
  cacheTimestamp = 0;
}
