import { type docs_v1, google } from "googleapis";
import { getAuthClient } from "./auth";
import {
  calculateDocumentStats,
  documentToText,
  extractHeadingsOnly,
  extractSectionContent,
  findHeadingByText,
  findSectionEnd,
  findTextInDocument,
  generateDeleteRequest,
  generateInsertRequests,
  getDocumentEndIndex,
} from "./document-parser";

// ============================================================================
// Types
// ============================================================================

/**
 * Options for reading a document with content limiting
 */
export interface ReadDocumentOptions {
  maxCharacters?: number;
  maxTokens?: number;
  headingsOnly?: boolean;
  includeMetadata?: boolean;
}

/**
 * Batch operation types
 */
export type BatchOperationType =
  | "append"
  | "replace_section"
  | "find_replace"
  | "delete_section"
  | "insert_after"
  | "insert_before";

/**
 * A single batch operation with its type and parameters
 */
export interface BatchOperation {
  operation: BatchOperationType;
  params: Record<string, unknown>;
}

/**
 * Result of a batch operation execution
 */
export interface BatchResult {
  success: boolean;
  completedOperations: number;
  totalOperations: number;
  results: Array<{
    index: number;
    success: boolean;
    message?: string;
  }>;
}

// ============================================================================
// Internal Helpers
// ============================================================================

/**
 * Get an authenticated Google Docs API client
 */
async function getDocsClient(): Promise<docs_v1.Docs> {
  const auth = await getAuthClient();
  return google.docs({ version: "v1", auth });
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

// ============================================================================
// Document Operations
// ============================================================================

/**
 * Get just the document title (for validation/identification)
 */
export async function getDocumentTitle(documentId: string): Promise<string> {
  console.log(`Getting title for document: ${documentId}`);
  const docs = await getDocsClient();
  const response = await docs.documents.get({ documentId });
  return response.data.title || "Untitled";
}

/**
 * Read a document and return its content as marked text
 * Supports content limiting options to reduce token usage
 */
export async function readDocument(
  documentId: string,
  options: ReadDocumentOptions = {},
): Promise<string> {
  console.log(`Reading document: ${documentId}`, options);

  const docs = await getDocsClient();

  const response = await docs.documents.get({
    documentId,
  });

  const document = response.data;
  const title = document.title || "Untitled";

  // If headingsOnly, return just the heading structure
  if (options.headingsOnly) {
    const fullContent = documentToText(document);
    const headings = extractHeadingsOnly(fullContent);
    const stats = calculateDocumentStats(document);
    let result = `# ${title}\n\n${headings}`;
    if (options.includeMetadata) {
      result += `\n\n---\nCharacters: ${stats.characterCount} | Words: ${stats.wordCount} | Headings: ${stats.headingCount}`;
    }
    console.log(`Document "${title}" read (headings only)`);
    return result;
  }

  let content = documentToText(document);
  const totalCharacters = content.length;

  // Apply maxTokens limit (estimate: 4 chars ≈ 1 token)
  let maxChars = options.maxCharacters;
  if (options.maxTokens) {
    const tokenBasedLimit = options.maxTokens * 4;
    maxChars = maxChars ? Math.min(maxChars, tokenBasedLimit) : tokenBasedLimit;
  }

  // Truncate if needed
  let truncated = false;
  if (maxChars && content.length > maxChars) {
    content = content.substring(0, maxChars);
    truncated = true;
  }

  let result = `# ${title}\n\n${content}`;

  if (truncated && maxChars) {
    result += `\n\n[Content truncated. Document contains approximately ${totalCharacters - maxChars} more characters.]`;
  }

  if (options.includeMetadata) {
    const stats = calculateDocumentStats(document);
    result += `\n\n---\nCharacters: ${stats.characterCount} | Words: ${stats.wordCount} | Headings: ${stats.headingCount}`;
  }

  console.log(`Document "${title}" read successfully`);

  return result;
}

/**
 * Get document metadata without fetching full content
 */
export async function getDocumentMetadata(documentId: string): Promise<{
  documentId: string;
  title: string;
  characterCount: number;
  wordCount: number;
  headingCount: number;
  headingStructure: string[];
}> {
  console.log(`Getting metadata for document: ${documentId}`);

  const docs = await getDocsClient();

  const response = await docs.documents.get({
    documentId,
  });

  const document = response.data;
  const title = document.title || "Untitled";
  const stats = calculateDocumentStats(document);

  console.log(`Metadata retrieved for "${title}"`);

  return {
    documentId,
    title,
    characterCount: stats.characterCount,
    wordCount: stats.wordCount,
    headingCount: stats.headingCount,
    headingStructure: stats.headingStructure,
  };
}

/**
 * Read a specific section of the document by heading
 */
export async function readSection(
  documentId: string,
  headingText: string,
  includeSubsections = true,
  maxCharacters?: number,
): Promise<string> {
  console.log(`Reading section "${headingText}" from document: ${documentId}`);

  const docs = await getDocsClient();

  const response = await docs.documents.get({
    documentId,
  });

  const document = response.data;
  const result = extractSectionContent(
    document,
    headingText,
    includeSubsections,
    maxCharacters,
  );

  if (!result.found) {
    throw new Error(`Section not found: "${headingText}"`);
  }

  console.log(`Section "${headingText}" read successfully`);
  return result.content;
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
 * Insert content before a specific heading (new section appears above the target heading)
 */
export async function insertBeforeHeading(
  documentId: string,
  headingText: string,
  content: string,
): Promise<string> {
  console.log(
    `Inserting content before heading "${headingText}" in document: ${documentId}`,
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

  // Insert BEFORE the heading (at its start index)
  const insertIndex = heading.startIndex;

  // Add a newline after the content to separate from the heading
  const contentToInsert = `${content}\n`;

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

  console.log(`Successfully inserted content before "${heading.text}"`);
  return `Successfully inserted content before heading "${heading.text}"`;
}

/**
 * Insert content after a specific heading (within the same section, after the heading text)
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

/**
 * Find and replace text throughout the document
 */
export async function findAndReplace(
  documentId: string,
  searchText: string,
  replaceText: string,
  matchCase = false,
): Promise<string> {
  console.log(
    `Finding and replacing "${searchText}" with "${replaceText}" in document: ${documentId}`,
  );

  const docs = await getDocsClient();

  // Use Google Docs native replaceAllText for efficiency
  const requests: docs_v1.Schema$Request[] = [
    {
      replaceAllText: {
        containsText: {
          text: searchText,
          matchCase,
        },
        replaceText,
      },
    },
  ];

  const response = await docs.documents.batchUpdate({
    documentId,
    requestBody: {
      requests,
    },
  });

  // Get the number of replacements from the response
  const replaceResult = response.data.replies?.[0]?.replaceAllText;
  const occurrencesChanged = replaceResult?.occurrencesChanged || 0;

  console.log(`Replaced ${occurrencesChanged} occurrence(s)`);
  return `Replaced ${occurrencesChanged} occurrence(s) of "${searchText}" with "${replaceText}"`;
}

/**
 * Search for text in the document and return matches with context
 */
export async function searchText(
  documentId: string,
  searchText: string,
  caseSensitive = false,
): Promise<string> {
  console.log(`Searching for "${searchText}" in document: ${documentId}`);

  const document = await getDocument(documentId);
  const matches = findTextInDocument(document, searchText, caseSensitive);

  if (matches.length === 0) {
    return `No matches found for "${searchText}"`;
  }

  const results = matches.map((match, index) => {
    return `${index + 1}. Found at position ${match.startIndex}-${match.endIndex}: "${match.text}"`;
  });

  return `Found ${matches.length} match(es) for "${searchText}":\n\n${results.join("\n")}`;
}

/**
 * Append content at the end of a section (just before the next heading)
 * This is useful for adding items to an existing list within a section
 */
export async function appendToSection(
  documentId: string,
  headingText: string,
  content: string,
): Promise<string> {
  console.log(
    `Appending content to section "${headingText}" in document: ${documentId}`,
  );

  const docs = await getDocsClient();
  const document = await getDocument(documentId);

  // Find the heading
  const heading = findHeadingByText(document, headingText);
  if (!heading) {
    throw new Error(`Heading not found: "${headingText}"`);
  }

  // Find the end of the section (where the next heading starts or document ends)
  const sectionEnd = findSectionEnd(document, heading);
  console.log(
    `Section "${heading.text}" spans from ${heading.startIndex} to ${sectionEnd}`,
  );

  // Insert at the end of the section (just before the next heading)
  // We subtract 1 to insert before the newline that precedes the next heading
  const insertIndex = sectionEnd;

  // Add content with a newline prefix
  const contentToInsert = `\n${content}`;

  // Generate insert and formatting requests
  const requests = generateInsertRequests(contentToInsert, insertIndex);

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

  console.log(`Successfully appended content to section "${heading.text}"`);
  return `Successfully appended content to section "${heading.text}"`;
}

/**
 * Execute multiple operations in a single call
 */
export async function batchOperations(
  documentId: string,
  operations: BatchOperation[],
  stopOnError = true,
): Promise<BatchResult> {
  console.log(
    `Executing ${operations.length} batch operations on document: ${documentId}`,
  );

  const results: BatchResult["results"] = [];
  let completedOperations = 0;

  for (let i = 0; i < operations.length; i++) {
    const op = operations[i];
    try {
      let message: string;

      switch (op.operation) {
        case "append":
          message = await appendContent(
            documentId,
            op.params.content as string,
          );
          break;
        case "replace_section":
          message = await replaceSection(
            documentId,
            op.params.headingText as string,
            op.params.newContent as string,
          );
          break;
        case "find_replace":
          message = await findAndReplace(
            documentId,
            op.params.searchText as string,
            op.params.replaceText as string,
            (op.params.matchCase as boolean) || false,
          );
          break;
        case "delete_section":
          message = await deleteSection(
            documentId,
            op.params.headingText as string,
          );
          break;
        case "insert_after":
          message = await insertAfterHeading(
            documentId,
            op.params.headingText as string,
            op.params.content as string,
          );
          break;
        case "insert_before":
          message = await insertBeforeHeading(
            documentId,
            op.params.headingText as string,
            op.params.content as string,
          );
          break;
        default:
          throw new Error(`Unknown operation: ${op.operation}`);
      }

      results.push({ index: i, success: true, message });
      completedOperations++;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      results.push({ index: i, success: false, message: errorMessage });

      if (stopOnError) {
        console.log(
          `Batch stopped at operation ${i} due to error: ${errorMessage}`,
        );
        break;
      }
    }
  }

  const success = completedOperations === operations.length;
  console.log(
    `Batch completed: ${completedOperations}/${operations.length} operations successful`,
  );

  return {
    success,
    completedOperations,
    totalOperations: operations.length,
    results,
  };
}

/**
 * Delete a specific section by heading
 */
export async function deleteSection(
  documentId: string,
  headingText: string,
): Promise<string> {
  console.log(`Deleting section "${headingText}" in document: ${documentId}`);

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

  // Delete the entire section (heading + content)
  const requests: docs_v1.Schema$Request[] = [
    generateDeleteRequest(heading.startIndex, sectionEnd),
  ];

  await docs.documents.batchUpdate({
    documentId,
    requestBody: {
      requests,
    },
  });

  console.log(`Successfully deleted section "${heading.text}"`);
  return `Successfully deleted section "${heading.text}"`;
}
