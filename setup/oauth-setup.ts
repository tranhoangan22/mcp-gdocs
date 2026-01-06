import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as http from "node:http";
import * as url from "node:url";
import {
  CreateSecretCommand,
  GetSecretValueCommand,
  PutSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import { google } from "googleapis";

interface GoogleCredentials {
  installed?: {
    client_id: string;
    client_secret: string;
    redirect_uris?: string[];
  };
  web?: {
    client_id: string;
    client_secret: string;
    redirect_uris?: string[];
  };
}

const CREDENTIALS_PATH = "./credentials.json";
const SECRET_NAME = "mcp-gdocs-credentials";
const SCOPES = [
  "https://www.googleapis.com/auth/documents",
  "https://www.googleapis.com/auth/drive.readonly",
];
const REDIRECT_PORT = 8085;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/oauth2callback`;

/**
 * Generate a secure random token for MCP endpoint authentication
 */
function generateSecretToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

async function main() {
  console.log("=== MCP Google Docs OAuth Setup ===\n");

  // 1. Read credentials.json
  console.log("Step 1: Reading credentials.json...");
  if (!fs.existsSync(CREDENTIALS_PATH)) {
    console.error(
      `\nError: ${CREDENTIALS_PATH} not found!\n\n` +
        "Please download your OAuth 2.0 Client credentials from Google Cloud Console:\n" +
        "1. Go to https://console.cloud.google.com/apis/credentials\n" +
        "2. Create or select an OAuth 2.0 Client ID (Desktop app type recommended)\n" +
        "3. Download the JSON file\n" +
        "4. Save it as 'credentials.json' in the project root\n",
    );
    process.exit(1);
  }

  const credentialsContent = fs.readFileSync(CREDENTIALS_PATH, "utf-8");
  const credentials: GoogleCredentials = JSON.parse(credentialsContent);

  // Extract client ID and secret (handle both 'installed' and 'web' formats)
  const clientConfig = credentials.installed || credentials.web;
  if (!clientConfig) {
    console.error(
      "Error: Invalid credentials.json format. Expected 'installed' or 'web' client configuration.",
    );
    process.exit(1);
  }

  const clientId = clientConfig.client_id;
  const clientSecret = clientConfig.client_secret;

  console.log(`  Client ID: ${clientId.substring(0, 20)}...`);
  console.log("  Client credentials loaded successfully!\n");

  // 2. Create OAuth2 client
  const oauth2Client = new google.auth.OAuth2(
    clientId,
    clientSecret,
    REDIRECT_URI,
  );

  // 3. Generate authorization URL
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent", // Force consent to ensure we get a refresh token
  });

  console.log("Step 2: Authorization required");
  console.log("\nPlease open this URL in your browser to authorize:\n");
  console.log(`  ${authUrl}\n`);

  // 4. Start local server to capture OAuth callback
  console.log("Step 3: Waiting for OAuth callback...");
  console.log(`  Listening on http://localhost:${REDIRECT_PORT}\n`);

  const code = await new Promise<string>((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      try {
        const reqUrl = url.parse(req.url || "", true);

        if (reqUrl.pathname === "/oauth2callback") {
          const code = reqUrl.query.code as string;
          const error = reqUrl.query.error as string;

          if (error) {
            res.writeHead(400, { "Content-Type": "text/html" });
            res.end(`
              <html>
                <body style="font-family: sans-serif; padding: 40px;">
                  <h1>Authorization Failed</h1>
                  <p>Error: ${error}</p>
                  <p>Please close this window and try again.</p>
                </body>
              </html>
            `);
            server.close();
            reject(new Error(`OAuth error: ${error}`));
            return;
          }

          if (code) {
            res.writeHead(200, { "Content-Type": "text/html" });
            res.end(`
              <html>
                <body style="font-family: sans-serif; padding: 40px;">
                  <h1>Authorization Successful!</h1>
                  <p>You can close this window and return to the terminal.</p>
                </body>
              </html>
            `);
            server.close();
            resolve(code);
          } else {
            res.writeHead(400, { "Content-Type": "text/html" });
            res.end(`
              <html>
                <body style="font-family: sans-serif; padding: 40px;">
                  <h1>Authorization Failed</h1>
                  <p>No authorization code received.</p>
                  <p>Please close this window and try again.</p>
                </body>
              </html>
            `);
          }
        } else {
          res.writeHead(404);
          res.end("Not found");
        }
      } catch (err) {
        console.error("Server error:", err);
        res.writeHead(500);
        res.end("Internal server error");
      }
    });

    server.listen(REDIRECT_PORT);

    // Timeout after 5 minutes
    setTimeout(
      () => {
        server.close();
        reject(new Error("OAuth flow timed out after 5 minutes"));
      },
      5 * 60 * 1000,
    );
  });

  console.log("  Authorization code received!\n");

  // 5. Exchange code for tokens
  console.log("Step 4: Exchanging code for tokens...");
  const { tokens } = await oauth2Client.getToken(code);

  if (!tokens.refresh_token) {
    console.error(
      "\nWarning: No refresh token received. This can happen if you've already authorized this app.\n" +
        "To get a new refresh token:\n" +
        "1. Go to https://myaccount.google.com/permissions\n" +
        "2. Remove access for your app\n" +
        "3. Run this setup again\n",
    );
    process.exit(1);
  }

  console.log("  Access token received!");
  console.log("  Refresh token received!");
  console.log(
    `  Token expires: ${new Date(tokens.expiry_date || 0).toISOString()}\n`,
  );

  // 6. Generate MCP secret token for URL-based authentication
  console.log("Step 5: Generating MCP secret token...");
  const mcpSecretToken = generateSecretToken();
  console.log("  Secret token generated!\n");

  // 7. Store credentials in AWS Secrets Manager
  console.log("Step 6: Storing credentials in AWS Secrets Manager...");

  const secretsClient = new SecretsManagerClient({});

  const secretValue = JSON.stringify({
    clientId,
    clientSecret,
    refreshToken: tokens.refresh_token,
    accessToken: tokens.access_token,
    expiryDate: tokens.expiry_date,
    mcpSecretToken,
  });

  try {
    // Try to update existing secret
    await secretsClient.send(
      new GetSecretValueCommand({ SecretId: SECRET_NAME }),
    );

    // Secret exists, update it
    await secretsClient.send(
      new PutSecretValueCommand({
        SecretId: SECRET_NAME,
        SecretString: secretValue,
      }),
    );
    console.log(`  Updated existing secret: ${SECRET_NAME}`);
  } catch (error: unknown) {
    // Check if error is because secret doesn't exist
    if (error instanceof Error && error.name === "ResourceNotFoundException") {
      // Create new secret
      await secretsClient.send(
        new CreateSecretCommand({
          Name: SECRET_NAME,
          SecretString: secretValue,
          Description: "Google OAuth credentials for MCP Google Docs server",
        }),
      );
      console.log(`  Created new secret: ${SECRET_NAME}`);
    } else {
      throw error;
    }
  }

  console.log("\n=== Setup Complete! ===\n");

  // Display the secret token prominently
  console.log(
    "╔════════════════════════════════════════════════════════════════════════════╗",
  );
  console.log(
    "║  YOUR SECRET TOKEN (save this - you'll need it for Claude!)               ║",
  );
  console.log(
    "╠════════════════════════════════════════════════════════════════════════════╣",
  );
  console.log(`║  ${mcpSecretToken}  ║`);
  console.log(
    "╚════════════════════════════════════════════════════════════════════════════╝\n",
  );

  console.log("Next steps:");
  console.log("1. Deploy the MCP server: npm run deploy");
  console.log(
    "2. Your endpoint URL will be: https://<api-id>.execute-api.<region>.amazonaws.com/v1/mcp/<TOKEN>",
  );
  console.log("3. Replace <TOKEN> with the secret token above");
  console.log("4. Add that full URL to Claude's connector settings\n");
  console.log(
    "⚠️  Keep this token secret! Anyone with the full URL can access your Google Docs.\n",
  );
}

main().catch((error) => {
  console.error("\nSetup failed:", error.message);
  process.exit(1);
});
