import type { OAuth2Client } from "google-auth-library";
import { type docs_v1, google } from "googleapis";
import {
  documentToText,
  findHeadingByText,
  findSectionEnd,
  generateDeleteRequest,
  generateInsertRequests,
  getDocumentEndIndex,
} from "./document-parser";
import {
  type GoogleCredentials,
  getCredentials,
  updateCredentials,
} from "./secrets";

let oauthClient: OAuth2Client | null = null;

/**
 * Initialize and return an authenticated OAuth2 client
 */
async function getAuthClient(): Promise<OAuth2Client> {
  if (oauthClient) {
    return oauthClient;
  }

  const credentials = await getCredentials();

  oauthClient = new google.auth.OAuth2(
    credentials.clientId,
    credentials.clientSecret,
  );

  oauthClient.setCredentials({
    refresh_token: credentials.refreshToken,
    access_token: credentials.accessToken,
    expiry_date: credentials.expiryDate,
  });

  // Handle token refresh
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
 * Get an authenticated Google Docs API client
 */
async function getDocsClient(): Promise<docs_v1.Docs> {
  const auth = await getAuthClient();
  return google.docs({ version: "v1", auth });
}

/**
 * Read a document and return its content as marked text
 */
export async function readDocument(documentId: string): Promise<string> {
  console.log(`Reading document: ${documentId}`);

  const docs = await getDocsClient();

  const response = await docs.documents.get({
    documentId,
  });

  const document = response.data;
  const title = document.title || "Untitled";
  const content = documentToText(document);

  console.log(`Document "${title}" read successfully`);

  return `# ${title}\n\n${content}`;
}

/**
 * Get the raw document object for internal operations
 */
async function getDocument(
  documentId: string,
): Promise<docs_v1.Schema$Document> {
  const docs = await getDocsClient();
  const response = await docs.documents.get({ documentId });
  return response.data;
}

/**
 * Append content to the end of a document
 */
export async function appendContent(
  documentId: string,
  content: string,
): Promise<string> {
  console.log(`Appending content to document: ${documentId}`);

  const docs = await getDocsClient();
  const document = await getDocument(documentId);

  // Get the end index for insertion
  const endIndex = getDocumentEndIndex(document);
  console.log(`Document end index: ${endIndex}`);

  // Add a newline before the new content if document isn't empty
  const contentToInsert = endIndex > 1 ? `\n${content}` : content;

  // Generate insert and formatting requests
  const requests = generateInsertRequests(contentToInsert, endIndex);

  if (requests.length === 0) {
    return "No content to append";
  }

  // Execute the batch update
  await docs.documents.batchUpdate({
    documentId,
    requestBody: {
      requests,
    },
  });

  console.log(`Successfully appended content with ${requests.length} requests`);
  return `Successfully appended content to document`;
}

/**
 * Insert content after a specific heading
 */
export async function insertAfterHeading(
  documentId: string,
  headingText: string,
  content: string,
): Promise<string> {
  console.log(
    `Inserting content after heading "${headingText}" in document: ${documentId}`,
  );

  const docs = await getDocsClient();
  const document = await getDocument(documentId);

  // Find the heading
  const heading = findHeadingByText(document, headingText);
  if (!heading) {
    throw new Error(`Heading not found: "${headingText}"`);
  }

  console.log(
    `Found heading at index ${heading.startIndex}-${heading.endIndex}`,
  );

  // Insert after the heading (at its end index)
  const insertIndex = heading.endIndex;

  // Add a newline before the content
  const contentToInsert = `\n${content}`;

  // Generate insert and formatting requests
  const requests = generateInsertRequests(contentToInsert, insertIndex);

  if (requests.length === 0) {
    return "No content to insert";
  }

  // Execute the batch update
  await docs.documents.batchUpdate({
    documentId,
    requestBody: {
      requests,
    },
  });

  console.log(`Successfully inserted content after "${heading.text}"`);
  return `Successfully inserted content after heading "${heading.text}"`;
}

/**
 * Replace the content of a section (heading + its content until next same-level heading)
 */
export async function replaceSection(
  documentId: string,
  headingText: string,
  newContent: string,
): Promise<string> {
  console.log(`Replacing section "${headingText}" in document: ${documentId}`);

  const docs = await getDocsClient();
  const document = await getDocument(documentId);

  // Find the heading
  const heading = findHeadingByText(document, headingText);
  if (!heading) {
    throw new Error(`Heading not found: "${headingText}"`);
  }

  // Find the end of the section
  const sectionEnd = findSectionEnd(document, heading);
  console.log(
    `Section "${heading.text}" spans from ${heading.startIndex} to ${sectionEnd}`,
  );

  // We need to:
  // 1. Delete the section content (after the heading, before next section)
  // 2. Insert new content

  const requests: docs_v1.Schema$Request[] = [];

  // Delete the content between heading end and section end
  if (heading.endIndex < sectionEnd) {
    requests.push(generateDeleteRequest(heading.endIndex, sectionEnd));
  }

  // Insert new content after the heading
  const contentToInsert = `\n${newContent}\n`;
  const insertRequests = generateInsertRequests(
    contentToInsert,
    heading.endIndex,
  );
  requests.push(...insertRequests);

  if (requests.length === 0) {
    return "No changes to make";
  }

  // Execute the batch update
  await docs.documents.batchUpdate({
    documentId,
    requestBody: {
      requests,
    },
  });

  console.log(`Successfully replaced section "${heading.text}"`);
  return `Successfully replaced section "${heading.text}"`;
}

/**
 * Replace the entire document content (fallback option, loses formatting)
 */
export async function replaceDocument(
  documentId: string,
  content: string,
): Promise<string> {
  console.log(`Replacing entire document: ${documentId}`);

  const docs = await getDocsClient();
  const document = await getDocument(documentId);

  const endIndex = getDocumentEndIndex(document);
  const requests: docs_v1.Schema$Request[] = [];

  // Delete all existing content (if any)
  if (endIndex > 1) {
    requests.push(generateDeleteRequest(1, endIndex));
  }

  // Insert new content at the beginning
  const insertRequests = generateInsertRequests(content, 1);
  requests.push(...insertRequests);

  if (requests.length === 0) {
    return "No content to write";
  }

  // Execute the batch update
  await docs.documents.batchUpdate({
    documentId,
    requestBody: {
      requests,
    },
  });

  console.log(
    `Successfully replaced document content with ${requests.length} requests`,
  );
  return "Successfully replaced document content";
}
