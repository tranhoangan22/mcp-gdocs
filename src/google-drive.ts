import { type drive_v3, google } from "googleapis";
import { getAuthClient } from "./auth";

// ============================================================================
// Types
// ============================================================================

/**
 * Document metadata returned from list operations
 */
export interface DocumentListItem {
  id: string;
  name: string;
  modifiedTime: string;
}

/**
 * File metadata for a single file
 */
export interface FileMetadata {
  id: string;
  name: string;
  mimeType: string;
}

// ============================================================================
// Internal Helpers
// ============================================================================

/**
 * Get an authenticated Google Drive API client
 */
async function getDriveClient(): Promise<drive_v3.Drive> {
  const auth = await getAuthClient();
  return google.drive({ version: "v3", auth });
}

// ============================================================================
// Drive Operations
// ============================================================================

/**
 * List Google Docs files from Drive
 *
 * @param query - Optional search query to filter by name
 * @param limit - Max results to return (default: 10, max: 50)
 * @returns Array of document metadata (id, name, modifiedTime)
 */
export async function listDocuments(
  query?: string,
  limit = 10,
): Promise<DocumentListItem[]> {
  console.log(
    `Listing documents${query ? ` with query: ${query}` : ""}, limit: ${limit}`,
  );

  const drive = await getDriveClient();

  // Build the query - filter for Google Docs only
  let q = "mimeType='application/vnd.google-apps.document' and trashed=false";

  if (query) {
    // Add name filter (case-insensitive contains)
    q += ` and name contains '${query.replace(/'/g, "\\'")}'`;
  }

  // Clamp limit to valid range
  const pageSize = Math.min(Math.max(1, limit), 50);

  const response = await drive.files.list({
    q,
    fields: "files(id, name, modifiedTime)",
    orderBy: "modifiedTime desc",
    pageSize,
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
  fileId: string,
): Promise<FileMetadata | null> {
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
