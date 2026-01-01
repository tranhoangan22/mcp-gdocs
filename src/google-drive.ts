import { google, drive_v3 } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import { getCredentials, updateCredentials, GoogleCredentials } from "./secrets";

let oauthClient: OAuth2Client | null = null;

/**
 * Initialize and return an authenticated OAuth2 client
 * Sets up token refresh handler to persist new tokens
 */
async function getAuthClient(): Promise<OAuth2Client> {
  if (oauthClient) {
    return oauthClient;
  }

  const credentials = await getCredentials();

  oauthClient = new google.auth.OAuth2(
    credentials.clientId,
    credentials.clientSecret
  );

  // Set the credentials
  oauthClient.setCredentials({
    refresh_token: credentials.refreshToken,
    access_token: credentials.accessToken,
    expiry_date: credentials.expiryDate,
  });

  // Handle token refresh events - persist new tokens to Secrets Manager
  oauthClient.on("tokens", async (tokens) => {
    console.log("Token refreshed, updating Secrets Manager");
    const currentCreds = await getCredentials();
    const updatedCreds: GoogleCredentials = {
      ...currentCreds,
      accessToken: tokens.access_token || currentCreds.accessToken,
      expiryDate: tokens.expiry_date || currentCreds.expiryDate,
    };
    if (tokens.refresh_token) {
      updatedCreds.refreshToken = tokens.refresh_token;
    }
    await updateCredentials(updatedCreds);
  });

  return oauthClient;
}

/**
 * Get an authenticated Google Drive API client
 */
async function getDriveClient(): Promise<drive_v3.Drive> {
  const auth = await getAuthClient();
  return google.drive({ version: "v3", auth });
}

/**
 * List Google Docs files from Drive
 *
 * @param query - Optional search query to filter by name
 * @returns Array of document metadata (id, name, modifiedTime)
 */
export async function listDocuments(
  query?: string
): Promise<Array<{ id: string; name: string; modifiedTime: string }>> {
  console.log(`Listing documents${query ? ` with query: ${query}` : ""}`);

  const drive = await getDriveClient();

  // Build the query - filter for Google Docs only
  let q = "mimeType='application/vnd.google-apps.document' and trashed=false";

  if (query) {
    // Add name filter (case-insensitive contains)
    q += ` and name contains '${query.replace(/'/g, "\\'")}'`;
  }

  const response = await drive.files.list({
    q,
    fields: "files(id, name, modifiedTime)",
    orderBy: "modifiedTime desc",
    pageSize: 50,
  });

  const files = response.data.files || [];

  console.log(`Found ${files.length} documents`);

  return files.map((file) => ({
    id: file.id || "",
    name: file.name || "",
    modifiedTime: file.modifiedTime || "",
  }));
}

/**
 * Get file metadata by ID
 */
export async function getFileMetadata(
  fileId: string
): Promise<{ id: string; name: string; mimeType: string } | null> {
  const drive = await getDriveClient();

  try {
    const response = await drive.files.get({
      fileId,
      fields: "id, name, mimeType",
    });

    return {
      id: response.data.id || "",
      name: response.data.name || "",
      mimeType: response.data.mimeType || "",
    };
  } catch (error) {
    console.error(`Error getting file metadata: ${error}`);
    return null;
  }
}
