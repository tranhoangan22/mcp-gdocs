import {
  appendContent,
  deleteSection,
  findAndReplace,
  insertAfterHeading,
  insertBeforeHeading,
  readDocument,
  replaceDocument,
  replaceSection,
  searchText,
} from "./google-docs";
import { listDocuments } from "./google-drive";

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
  {
    name: "list_documents",
    description:
      "List Google Docs in your Drive. Returns document names and IDs. Use the ID to read or edit a document.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Optional search query to filter documents by name (case-insensitive)",
        },
      },
      required: [],
    },
  },
  {
    name: "read_document",
    description:
      "Read the content of a Google Doc. Returns the document with [H1], [H2], [H3] markers for headings and [text](url) for links.",
    inputSchema: {
      type: "object",
      properties: {
        documentId: {
          type: "string",
          description:
            "The Google Doc ID (from list_documents or the document URL)",
        },
      },
      required: ["documentId"],
    },
  },
  {
    name: "append_content",
    description:
      "Add content to the end of a Google Doc. Use [H1], [H2], [H3] markers at the start of lines for headings. Use [text](url) for links.",
    inputSchema: {
      type: "object",
      properties: {
        documentId: {
          type: "string",
          description: "The Google Doc ID",
        },
        content: {
          type: "string",
          description:
            "Content to append. Use [H1], [H2], [H3] for headings, [text](url) for links",
        },
      },
      required: ["documentId", "content"],
    },
  },
  {
    name: "insert_before_heading",
    description:
      "Insert a new section BEFORE a specific heading. Use this when you want to add a completely new section that should appear above the target heading. The heading is matched by text (case-insensitive, partial match supported).",
    inputSchema: {
      type: "object",
      properties: {
        documentId: {
          type: "string",
          description: "The Google Doc ID",
        },
        headingText: {
          type: "string",
          description:
            "The heading text to find (case-insensitive, partial match). New content will be inserted BEFORE this heading.",
        },
        content: {
          type: "string",
          description:
            "Content to insert before the heading. Use [H1], [H2], [H3] for headings, [text](url) for links",
        },
      },
      required: ["documentId", "headingText", "content"],
    },
  },
  {
    name: "insert_after_heading",
    description:
      "Insert content immediately after a heading line (within the same section). Use this to add content to an existing section. The heading is matched by text (case-insensitive, partial match supported).",
    inputSchema: {
      type: "object",
      properties: {
        documentId: {
          type: "string",
          description: "The Google Doc ID",
        },
        headingText: {
          type: "string",
          description:
            "The heading text to find (case-insensitive, partial match)",
        },
        content: {
          type: "string",
          description:
            "Content to insert after the heading. Use [H1], [H2], [H3] for headings, [text](url) for links",
        },
      },
      required: ["documentId", "headingText", "content"],
    },
  },
  {
    name: "replace_section",
    description:
      "Replace the content under a heading (everything between this heading and the next heading of same or higher level). The heading itself is preserved.",
    inputSchema: {
      type: "object",
      properties: {
        documentId: {
          type: "string",
          description: "The Google Doc ID",
        },
        headingText: {
          type: "string",
          description:
            "The heading text to find (case-insensitive, partial match). Content under this heading will be replaced.",
        },
        newContent: {
          type: "string",
          description:
            "New content for the section. Use [H1], [H2], [H3] for headings, [text](url) for links",
        },
      },
      required: ["documentId", "headingText", "newContent"],
    },
  },
  {
    name: "replace_document",
    description:
      "Replace the entire document content. WARNING: This will remove all existing content and formatting. Use append_content, insert_after_heading, or replace_section for surgical edits.",
    inputSchema: {
      type: "object",
      properties: {
        documentId: {
          type: "string",
          description: "The Google Doc ID",
        },
        content: {
          type: "string",
          description:
            "New content for the entire document. Use [H1], [H2], [H3] for headings, [text](url) for links",
        },
      },
      required: ["documentId", "content"],
    },
  },
  {
    name: "find_and_replace",
    description:
      "Find and replace text throughout the document. Useful for updating specific text like dates, names, locations, or any repeated text. Replaces ALL occurrences.",
    inputSchema: {
      type: "object",
      properties: {
        documentId: {
          type: "string",
          description: "The Google Doc ID",
        },
        searchText: {
          type: "string",
          description: "The text to find (will match all occurrences)",
        },
        replaceText: {
          type: "string",
          description: "The text to replace it with",
        },
        matchCase: {
          type: "boolean",
          description:
            "Whether to match case exactly (default: false, case-insensitive)",
        },
      },
      required: ["documentId", "searchText", "replaceText"],
    },
  },
  {
    name: "search_text",
    description:
      "Search for text in the document and return all matches with their positions. Useful for finding specific content before making changes.",
    inputSchema: {
      type: "object",
      properties: {
        documentId: {
          type: "string",
          description: "The Google Doc ID",
        },
        searchText: {
          type: "string",
          description: "The text to search for",
        },
        caseSensitive: {
          type: "boolean",
          description: "Whether to match case exactly (default: false)",
        },
      },
      required: ["documentId", "searchText"],
    },
  },
  {
    name: "delete_section",
    description:
      "Delete an entire section including its heading and all content underneath it (until the next heading of same or higher level). Use with caution.",
    inputSchema: {
      type: "object",
      properties: {
        documentId: {
          type: "string",
          description: "The Google Doc ID",
        },
        headingText: {
          type: "string",
          description:
            "The heading text to find (case-insensitive, partial match). The entire section will be deleted.",
        },
      },
      required: ["documentId", "headingText"],
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
    case "list_documents": {
      const query = args.query as string | undefined;
      const docs = await listDocuments(query);
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
      const documentId = args.documentId as string;
      if (!documentId) {
        throw new Error("documentId is required");
      }
      return await readDocument(documentId);
    }

    case "append_content": {
      const documentId = args.documentId as string;
      const content = args.content as string;
      if (!documentId || !content) {
        throw new Error("documentId and content are required");
      }
      return await appendContent(documentId, content);
    }

    case "insert_before_heading": {
      const documentId = args.documentId as string;
      const headingText = args.headingText as string;
      const content = args.content as string;
      if (!documentId || !headingText || !content) {
        throw new Error("documentId, headingText, and content are required");
      }
      return await insertBeforeHeading(documentId, headingText, content);
    }

    case "insert_after_heading": {
      const documentId = args.documentId as string;
      const headingText = args.headingText as string;
      const content = args.content as string;
      if (!documentId || !headingText || !content) {
        throw new Error("documentId, headingText, and content are required");
      }
      return await insertAfterHeading(documentId, headingText, content);
    }

    case "replace_section": {
      const documentId = args.documentId as string;
      const headingText = args.headingText as string;
      const newContent = args.newContent as string;
      if (!documentId || !headingText || !newContent) {
        throw new Error("documentId, headingText, and newContent are required");
      }
      return await replaceSection(documentId, headingText, newContent);
    }

    case "replace_document": {
      const documentId = args.documentId as string;
      const content = args.content as string;
      if (!documentId || !content) {
        throw new Error("documentId and content are required");
      }
      return await replaceDocument(documentId, content);
    }

    case "find_and_replace": {
      const documentId = args.documentId as string;
      const search = args.searchText as string;
      const replace = args.replaceText as string;
      const matchCase = (args.matchCase as boolean) || false;
      if (!documentId || !search || replace === undefined) {
        throw new Error("documentId, searchText, and replaceText are required");
      }
      return await findAndReplace(documentId, search, replace, matchCase);
    }

    case "search_text": {
      const documentId = args.documentId as string;
      const search = args.searchText as string;
      const caseSensitive = (args.caseSensitive as boolean) || false;
      if (!documentId || !search) {
        throw new Error("documentId and searchText are required");
      }
      return await searchText(documentId, search, caseSensitive);
    }

    case "delete_section": {
      const documentId = args.documentId as string;
      const headingText = args.headingText as string;
      if (!documentId || !headingText) {
        throw new Error("documentId and headingText are required");
      }
      return await deleteSection(documentId, headingText);
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
