import {
  appendContent,
  appendToSection,
  type BatchOperation,
  batchOperations,
  deleteSection,
  findAndReplace,
  getDocumentMetadata,
  getDocumentTitle,
  insertAfterHeading,
  insertBeforeHeading,
  readDocument,
  readSection,
  replaceDocument,
  replaceSection,
  searchText,
} from "./google-docs";
import { getFileMetadata, listDocuments } from "./google-drive";

/**
 * Currently selected document for operations
 */
let currentDocument: { id: string; name: string } | null = null;

/**
 * Extract document ID from a Google Docs URL or return the ID if already extracted
 * Supports formats:
 * - https://docs.google.com/document/d/DOCUMENT_ID/edit
 * - https://docs.google.com/document/d/DOCUMENT_ID/edit?usp=sharing
 * - https://docs.google.com/document/d/DOCUMENT_ID
 * - Raw document ID
 */
function extractDocumentId(input: string): string {
  const trimmed = input.trim();

  // Try to extract from URL
  const urlMatch = trimmed.match(
    /docs\.google\.com\/document\/d\/([a-zA-Z0-9_-]+)/,
  );
  if (urlMatch) {
    return urlMatch[1];
  }

  // Assume it's already a document ID
  return trimmed;
}

/**
 * Get the effective document ID - from args or from current document
 */
function getEffectiveDocumentId(args: Record<string, unknown>): string | null {
  const argDocId = args.documentId as string | undefined;
  if (argDocId) {
    return extractDocumentId(argDocId);
  }
  return currentDocument?.id || null;
}

/**
 * MCP Tool Definition
 */
interface Tool {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, { type: string; description: string }>;
    required: string[];
  };
}

/**
 * MCP JSON-RPC Request
 */
interface MCPRequest {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

/**
 * MCP JSON-RPC Response
 */
interface MCPResponse {
  jsonrpc: "2.0";
  id: number | string;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

/**
 * Tool definitions for the MCP server
 */
const tools: Tool[] = [
  // ============ DOCUMENT SETUP & NAVIGATION ============
  {
    name: "resolve_url",
    description:
      "Extract doc ID from URL and get file metadata. Use to verify URL before operations. Does NOT set as current document.",
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "Google Docs URL to resolve.",
        },
      },
      required: ["url"],
    },
  },
  {
    name: "set_document",
    description:
      "Set working document for subsequent operations. After calling, omit documentId in other tools.",
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "Google Docs URL or document ID.",
        },
      },
      required: ["url"],
    },
  },
  {
    name: "get_current_document",
    description: "Check which document is currently set as working document.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "list_documents",
    description:
      "Search Google Docs by name. Returns names and IDs sorted by last modified.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Filter by name (partial match). Empty = recent docs.",
        },
        limit: {
          type: "number",
          description: "Max results (default: 10, max: 50).",
        },
      },
      required: [],
    },
  },

  // ============ READING ============
  {
    name: "read_document",
    description:
      "Read document content. Returns [H1]/[H2]/[H3] for headings, [text](url) for links, • for bullets. Use maxCharacters/maxTokens to limit response size, headingsOnly for structure overview.",
    inputSchema: {
      type: "object",
      properties: {
        documentId: {
          type: "string",
          description: "Doc ID or URL. Optional if set_document was used.",
        },
        maxCharacters: {
          type: "number",
          description: "Truncate content after N characters.",
        },
        maxTokens: {
          type: "number",
          description: "Truncate after ~N tokens (4 chars ≈ 1 token).",
        },
        headingsOnly: {
          type: "boolean",
          description: "Return only heading structure, no body content.",
        },
        includeMetadata: {
          type: "boolean",
          description: "Include word count, character count, heading count.",
        },
      },
      required: [],
    },
  },
  {
    name: "get_document_metadata",
    description:
      "Get document structure without full content. Returns title, character/word/heading counts, and heading structure. Use before read_document to understand document size.",
    inputSchema: {
      type: "object",
      properties: {
        documentId: {
          type: "string",
          description: "Doc ID or URL. Optional if set_document was used.",
        },
      },
      required: [],
    },
  },
  {
    name: "read_section",
    description:
      "Read specific section by heading text. Returns content from heading until next same-level heading. More efficient than reading entire document.",
    inputSchema: {
      type: "object",
      properties: {
        documentId: {
          type: "string",
          description: "Doc ID or URL. Optional if set_document was used.",
        },
        headingText: {
          type: "string",
          description: "Heading to find (case-insensitive partial match).",
        },
        includeSubsections: {
          type: "boolean",
          description: "Include nested headings. Default: true.",
        },
        maxCharacters: {
          type: "number",
          description: "Truncate section content after N characters.",
        },
      },
      required: ["headingText"],
    },
  },
  {
    name: "search_text",
    description:
      "Find text occurrences with positions. Use to verify text exists before find_and_replace or locate content.",
    inputSchema: {
      type: "object",
      properties: {
        documentId: {
          type: "string",
          description: "Doc ID or URL. Optional if set_document was used.",
        },
        searchText: {
          type: "string",
          description: "Text to search for (partial match supported).",
        },
        caseSensitive: {
          type: "boolean",
          description: "Match case exactly. Default: false.",
        },
      },
      required: ["searchText"],
    },
  },

  // ============ ADDING CONTENT ============
  {
    name: "append_content",
    description:
      "Add content at document end. Format: [H1]/[H2]/[H3] for headings, [text](url) for links, • for bullets.",
    inputSchema: {
      type: "object",
      properties: {
        documentId: {
          type: "string",
          description: "Doc ID or URL. Optional if set_document was used.",
        },
        content: {
          type: "string",
          description: "Content to append with formatting markers.",
        },
      },
      required: ["content"],
    },
  },
  {
    name: "insert_before_heading",
    description:
      "Insert content ABOVE a heading. Use to add new section before existing one.",
    inputSchema: {
      type: "object",
      properties: {
        documentId: {
          type: "string",
          description: "Doc ID or URL. Optional if set_document was used.",
        },
        headingText: {
          type: "string",
          description:
            "Heading to find (partial match). Content appears above it.",
        },
        content: {
          type: "string",
          description: "Content to insert with formatting markers.",
        },
      },
      required: ["headingText", "content"],
    },
  },
  {
    name: "insert_after_heading",
    description:
      "Insert content immediately after heading line. Use to add intro text at section top.",
    inputSchema: {
      type: "object",
      properties: {
        documentId: {
          type: "string",
          description: "Doc ID or URL. Optional if set_document was used.",
        },
        headingText: {
          type: "string",
          description:
            "Heading to find (partial match). Content appears after it.",
        },
        content: {
          type: "string",
          description: "Content to insert with formatting markers.",
        },
      },
      required: ["headingText", "content"],
    },
  },
  {
    name: "append_to_section",
    description:
      "Add content at section bottom (before next heading). Best for adding bullets to existing lists.",
    inputSchema: {
      type: "object",
      properties: {
        documentId: {
          type: "string",
          description: "Doc ID or URL. Optional if set_document was used.",
        },
        headingText: {
          type: "string",
          description: "Section heading (partial match). Content added at end.",
        },
        content: {
          type: "string",
          description: "Content to append with formatting markers.",
        },
      },
      required: ["headingText", "content"],
    },
  },

  // ============ MODIFYING CONTENT ============
  {
    name: "find_and_replace",
    description:
      "Replace all occurrences of text. Use search_text first to verify matches. Plain text only.",
    inputSchema: {
      type: "object",
      properties: {
        documentId: {
          type: "string",
          description: "Doc ID or URL. Optional if set_document was used.",
        },
        searchText: {
          type: "string",
          description: "Text to find. All occurrences replaced.",
        },
        replaceText: {
          type: "string",
          description: "Replacement text. Empty string = delete.",
        },
        matchCase: {
          type: "boolean",
          description: "Match case exactly. Default: false.",
        },
      },
      required: ["searchText", "replaceText"],
    },
  },
  {
    name: "replace_section",
    description:
      "Replace all content under a heading (keeps heading). DESTRUCTIVE to section content.",
    inputSchema: {
      type: "object",
      properties: {
        documentId: {
          type: "string",
          description: "Doc ID or URL. Optional if set_document was used.",
        },
        headingText: {
          type: "string",
          description: "Section heading (partial match). Content replaced.",
        },
        newContent: {
          type: "string",
          description: "New section content with formatting markers.",
        },
      },
      required: ["headingText", "newContent"],
    },
  },
  {
    name: "replace_document",
    description:
      "Replace ENTIRE document. DESTRUCTIVE. Use targeted tools for partial edits.",
    inputSchema: {
      type: "object",
      properties: {
        documentId: {
          type: "string",
          description: "Doc ID or URL. Optional if set_document was used.",
        },
        content: {
          type: "string",
          description: "Complete new document content with formatting markers.",
        },
      },
      required: ["content"],
    },
  },

  // ============ DELETING CONTENT ============
  {
    name: "delete_section",
    description:
      "Delete section including heading and all content. DESTRUCTIVE, cannot be undone.",
    inputSchema: {
      type: "object",
      properties: {
        documentId: {
          type: "string",
          description: "Doc ID or URL. Optional if set_document was used.",
        },
        headingText: {
          type: "string",
          description: "Section heading to delete (partial match).",
        },
      },
      required: ["headingText"],
    },
  },

  // ============ BATCH OPERATIONS ============
  {
    name: "batch_operations",
    description:
      "Execute multiple write operations in one call. Reduces round-trips. Operations: append, replace_section, find_replace, delete_section, insert_after, insert_before.",
    inputSchema: {
      type: "object",
      properties: {
        documentId: {
          type: "string",
          description: "Doc ID or URL. Optional if set_document was used.",
        },
        operations: {
          type: "array",
          description:
            "Array of operations. Each: {operation: string, params: object}. Operations: append(content), replace_section(headingText, newContent), find_replace(searchText, replaceText, matchCase?), delete_section(headingText), insert_after(headingText, content), insert_before(headingText, content).",
        },
        stopOnError: {
          type: "boolean",
          description: "Stop on first error. Default: true.",
        },
      },
      required: ["operations"],
    },
  },
];

/**
 * Execute a tool call
 */
async function executeTool(
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  console.log(`Executing tool: ${name}`, JSON.stringify(args));

  switch (name) {
    case "set_document": {
      const url = args.url as string;
      if (!url) {
        throw new Error("url is required");
      }
      const documentId = extractDocumentId(url);
      const documentName = await getDocumentTitle(documentId);
      currentDocument = { id: documentId, name: documentName };
      return `Document set: "${documentName}"\nID: ${documentId}`;
    }

    case "get_current_document": {
      if (!currentDocument) {
        return "No document currently set. Use set_document first.";
      }
      return `Current document: "${currentDocument.name}"\nID: ${currentDocument.id}`;
    }

    case "list_documents": {
      const query = args.query as string | undefined;
      const limit = (args.limit as number) || 10;
      const docs = await listDocuments(query, limit);
      if (docs.length === 0) {
        return query
          ? `No documents found matching "${query}"`
          : "No documents found in your Drive";
      }
      const docList = docs
        .map((doc) => `- ${doc.name}\n  ID: ${doc.id}`)
        .join("\n");
      return `Found ${docs.length} document(s):\n\n${docList}`;
    }

    case "read_document": {
      const documentId = getEffectiveDocumentId(args);
      if (!documentId) {
        throw new Error(
          "documentId is required (provide it or use set_document first)",
        );
      }
      const options = {
        maxCharacters: args.maxCharacters as number | undefined,
        maxTokens: args.maxTokens as number | undefined,
        headingsOnly: args.headingsOnly as boolean | undefined,
        includeMetadata: args.includeMetadata as boolean | undefined,
      };
      return await readDocument(documentId, options);
    }

    case "get_document_metadata": {
      const documentId = getEffectiveDocumentId(args);
      if (!documentId) {
        throw new Error(
          "documentId is required (provide it or use set_document first)",
        );
      }
      const metadata = await getDocumentMetadata(documentId);
      return `Document: "${metadata.title}"
ID: ${metadata.documentId}
Characters: ${metadata.characterCount}
Words: ${metadata.wordCount}
Headings: ${metadata.headingCount}

Structure:
${metadata.headingStructure.join("\n")}`;
    }

    case "read_section": {
      const documentId = getEffectiveDocumentId(args);
      const headingText = args.headingText as string;
      const includeSubsections = (args.includeSubsections as boolean) ?? true;
      const maxCharacters = args.maxCharacters as number | undefined;
      if (!documentId) {
        throw new Error(
          "documentId is required (provide it or use set_document first)",
        );
      }
      if (!headingText) {
        throw new Error("headingText is required");
      }
      return await readSection(
        documentId,
        headingText,
        includeSubsections,
        maxCharacters,
      );
    }

    case "append_content": {
      const documentId = getEffectiveDocumentId(args);
      const content = args.content as string;
      if (!documentId) {
        throw new Error(
          "documentId is required (provide it or use set_document first)",
        );
      }
      if (!content) {
        throw new Error("content is required");
      }
      return await appendContent(documentId, content);
    }

    case "insert_before_heading": {
      const documentId = getEffectiveDocumentId(args);
      const headingText = args.headingText as string;
      const content = args.content as string;
      if (!documentId) {
        throw new Error(
          "documentId is required (provide it or use set_document first)",
        );
      }
      if (!headingText || !content) {
        throw new Error("headingText and content are required");
      }
      return await insertBeforeHeading(documentId, headingText, content);
    }

    case "insert_after_heading": {
      const documentId = getEffectiveDocumentId(args);
      const headingText = args.headingText as string;
      const content = args.content as string;
      if (!documentId) {
        throw new Error(
          "documentId is required (provide it or use set_document first)",
        );
      }
      if (!headingText || !content) {
        throw new Error("headingText and content are required");
      }
      return await insertAfterHeading(documentId, headingText, content);
    }

    case "append_to_section": {
      const documentId = getEffectiveDocumentId(args);
      const headingText = args.headingText as string;
      const content = args.content as string;
      if (!documentId) {
        throw new Error(
          "documentId is required (provide it or use set_document first)",
        );
      }
      if (!headingText || !content) {
        throw new Error("headingText and content are required");
      }
      return await appendToSection(documentId, headingText, content);
    }

    case "replace_section": {
      const documentId = getEffectiveDocumentId(args);
      const headingText = args.headingText as string;
      const newContent = args.newContent as string;
      if (!documentId) {
        throw new Error(
          "documentId is required (provide it or use set_document first)",
        );
      }
      if (!headingText || !newContent) {
        throw new Error("headingText and newContent are required");
      }
      return await replaceSection(documentId, headingText, newContent);
    }

    case "replace_document": {
      const documentId = getEffectiveDocumentId(args);
      const content = args.content as string;
      if (!documentId) {
        throw new Error(
          "documentId is required (provide it or use set_document first)",
        );
      }
      if (!content) {
        throw new Error("content is required");
      }
      return await replaceDocument(documentId, content);
    }

    case "find_and_replace": {
      const documentId = getEffectiveDocumentId(args);
      const search = args.searchText as string;
      const replace = args.replaceText as string;
      const matchCase = (args.matchCase as boolean) || false;
      if (!documentId) {
        throw new Error(
          "documentId is required (provide it or use set_document first)",
        );
      }
      if (!search || replace === undefined) {
        throw new Error("searchText and replaceText are required");
      }
      return await findAndReplace(documentId, search, replace, matchCase);
    }

    case "search_text": {
      const documentId = getEffectiveDocumentId(args);
      const search = args.searchText as string;
      const caseSensitive = (args.caseSensitive as boolean) || false;
      if (!documentId) {
        throw new Error(
          "documentId is required (provide it or use set_document first)",
        );
      }
      if (!search) {
        throw new Error("searchText is required");
      }
      return await searchText(documentId, search, caseSensitive);
    }

    case "delete_section": {
      const documentId = getEffectiveDocumentId(args);
      const headingText = args.headingText as string;
      if (!documentId) {
        throw new Error(
          "documentId is required (provide it or use set_document first)",
        );
      }
      if (!headingText) {
        throw new Error("headingText is required");
      }
      return await deleteSection(documentId, headingText);
    }

    case "batch_operations": {
      const documentId = getEffectiveDocumentId(args);
      const operations = args.operations as BatchOperation[];
      const stopOnError = (args.stopOnError as boolean) ?? true;
      if (!documentId) {
        throw new Error(
          "documentId is required (provide it or use set_document first)",
        );
      }
      if (
        !operations ||
        !Array.isArray(operations) ||
        operations.length === 0
      ) {
        throw new Error("operations array is required and must not be empty");
      }
      const result = await batchOperations(documentId, operations, stopOnError);
      const summary = result.results
        .map(
          (r) => `${r.index + 1}. ${r.success ? "✓" : "✗"} ${r.message || ""}`,
        )
        .join("\n");
      return `Batch: ${result.completedOperations}/${result.totalOperations} operations completed${result.success ? "" : " (stopped on error)"}\n\n${summary}`;
    }

    case "resolve_url": {
      const url = args.url as string;
      if (!url) {
        throw new Error("url is required");
      }
      const documentId = extractDocumentId(url);
      const metadata = await getFileMetadata(documentId);
      if (!metadata) {
        throw new Error(
          `Could not retrieve file metadata for ID: ${documentId}. The file may not exist or you may not have access.`,
        );
      }
      return `Document found:\n  Name: ${metadata.name}\n  ID: ${metadata.id}\n  Type: ${metadata.mimeType}`;
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

/**
 * Handle an MCP JSON-RPC request
 */
export async function handleMCPRequest(
  request: MCPRequest,
): Promise<MCPResponse> {
  console.log(
    `MCP Request: ${request.method}`,
    JSON.stringify(request.params || {}),
  );

  try {
    switch (request.method) {
      case "initialize":
        return {
          jsonrpc: "2.0",
          id: request.id,
          result: {
            protocolVersion: "2024-11-05",
            capabilities: {
              tools: {},
            },
            serverInfo: {
              name: "mcp-gdocs",
              version: "1.0.0",
            },
          },
        };

      case "initialized":
        // Acknowledgment, no response needed but we return empty result
        return {
          jsonrpc: "2.0",
          id: request.id,
          result: {},
        };

      case "tools/list":
        return {
          jsonrpc: "2.0",
          id: request.id,
          result: {
            tools,
          },
        };

      case "tools/call": {
        const params = request.params as {
          name: string;
          arguments?: Record<string, unknown>;
        };
        if (!params?.name) {
          throw new Error("Tool name is required");
        }
        const result = await executeTool(params.name, params.arguments || {});
        return {
          jsonrpc: "2.0",
          id: request.id,
          result: {
            content: [{ type: "text", text: result }],
          },
        };
      }

      case "ping":
        return {
          jsonrpc: "2.0",
          id: request.id,
          result: {},
        };

      default:
        return {
          jsonrpc: "2.0",
          id: request.id,
          error: {
            code: -32601,
            message: `Method not found: ${request.method}`,
          },
        };
    }
  } catch (error) {
    console.error(`Error handling request: ${error}`);
    const message = error instanceof Error ? error.message : String(error);
    return {
      jsonrpc: "2.0",
      id: request.id,
      error: {
        code: -32603,
        message,
      },
    };
  }
}
