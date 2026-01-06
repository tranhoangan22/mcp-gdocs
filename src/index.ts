import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { handleMCPRequest } from "./mcp-server";
import { validateSecretToken } from "./secrets";

/**
 * Lambda handler for MCP server
 * Receives JSON-RPC requests via API Gateway POST /mcp/{token}
 */
export async function handler(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  console.log(`Request: ${event.httpMethod} ${event.path}`);

  // CORS headers for preflight requests
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
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

  // Validate secret token from URL path
  const token = event.pathParameters?.token;
  const isValid = await validateSecretToken(token);
  if (!isValid) {
    console.log("Auth failed: invalid or missing token");
    return {
      statusCode: 403,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32600,
          message: "Forbidden: Invalid or missing token",
        },
      }),
    };
  }

  // Parse request body
  let parsedBody: Record<string, unknown>;
  try {
    if (!event.body) {
      throw new Error("Request body is empty");
    }
    parsedBody = JSON.parse(event.body);
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
  if (
    !parsedBody.jsonrpc ||
    parsedBody.jsonrpc !== "2.0" ||
    !parsedBody.method
  ) {
    return {
      statusCode: 400,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: parsedBody.id || null,
        error: {
          code: -32600,
          message: "Invalid Request: Must be a valid JSON-RPC 2.0 request",
        },
      }),
    };
  }

  // At this point we know the request is valid MCP format
  const request = {
    jsonrpc: parsedBody.jsonrpc as "2.0",
    id: parsedBody.id as number | string,
    method: parsedBody.method as string,
    params: parsedBody.params as Record<string, unknown> | undefined,
  };

  // Handle the MCP request
  try {
    const response = await handleMCPRequest(request);

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
