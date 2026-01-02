import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { handleMCPRequest } from "./mcp-server";

/**
 * Lambda handler for MCP server
 * Receives JSON-RPC requests via API Gateway POST /mcp
 */
export async function handler(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  console.log("Received request:", JSON.stringify(event, null, 2));

  // CORS headers for preflight requests
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, x-api-key",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };

  // Handle preflight OPTIONS request
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: "",
    };
  }

  // Only accept POST requests
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32600,
          message: "Method not allowed. Use POST.",
        },
      }),
    };
  }

  // Parse request body
  let request: unknown;
  try {
    if (!event.body) {
      throw new Error("Request body is empty");
    }
    request = JSON.parse(event.body);
  } catch (error) {
    console.error("Failed to parse request body:", error);
    return {
      statusCode: 400,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32700,
          message: "Parse error: Invalid JSON",
        },
      }),
    };
  }

  // Validate JSON-RPC request format
  if (!request.jsonrpc || request.jsonrpc !== "2.0" || !request.method) {
    return {
      statusCode: 400,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: request.id || null,
        error: {
          code: -32600,
          message: "Invalid Request: Must be a valid JSON-RPC 2.0 request",
        },
      }),
    };
  }

  // Handle the MCP request
  try {
    const response = await handleMCPRequest(request);
    console.log("MCP Response:", JSON.stringify(response, null, 2));

    return {
      statusCode: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error("Unhandled error:", error);
    const message = error instanceof Error ? error.message : String(error);

    return {
      statusCode: 500,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: request.id,
        error: {
          code: -32603,
          message: `Internal error: ${message}`,
        },
      }),
    };
  }
}
