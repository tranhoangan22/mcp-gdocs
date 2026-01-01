# Claude Code Project Setup Prompt

# MCP Server for Google Docs Editing via Claude Mobile

## Context

I want to build an MCP (Model Context Protocol) server that allows Claude on iOS to read and edit Google Docs stored in my Google Drive. This enables me to have conversations with Claude on my phone and have it directly edit my documents without copy-pasting.

**My specific use case:** I have a travel planning document (wedding trip to Vietnam) with formatted headings, emoji icons, colored text, and hyperlinks. I want Claude to be able to add sections, update content, and make edits while preserving the document's formatting.

## Why Google Docs API (not DOCX)

- Google Docs API provides **structured access** to document content
- Can make **surgical edits** (insert at position, append, replace section) rather than replacing entire document
- **Preserves formatting** outside of edited regions
- Links, colored headings, emoji all survive the editing process

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Claude Mobile  │────▶│  AWS Lambda +    │────▶│  Google APIs    │
│      App        │◀────│  API Gateway     │◀────│  - Docs API     │
└─────────────────┘     └──────────────────┘     │  - Drive API    │
                               │                 └─────────────────┘
                               ▼
                        ┌──────────────────┐
                        │ Secrets Manager  │
                        │ (OAuth tokens)   │
                        └──────────────────┘
```

## Project Requirements

### Technology Stack

- **Runtime:** Node.js 18+ with TypeScript
- **Cloud:** AWS Lambda + API Gateway + Secrets Manager
- **Infrastructure as Code:** AWS CDK (TypeScript)
- **Google APIs:** googleapis npm package

### OAuth Scopes Required

- `https://www.googleapis.com/auth/documents` (read/write Google Docs)
- `https://www.googleapis.com/auth/drive.readonly` (list files in Drive)

### MCP Tools to Implement

1. **`list_documents`**

   - Input: Optional `query` string to filter by name
   - Output: List of Google Doc names and IDs
   - Implementation: Drive API `files.list` with MIME type filter for Google Docs

2. **`read_document`**

   - Input: `documentId` (Google Doc ID)
   - Output: Document content with structural markers
   - Implementation: Docs API `documents.get`, then parse structure into readable format
   - Output format should use `[H1]`, `[H2]`, `[H3]` for headings and `[text](url)` for links

3. **`append_content`**

   - Input: `documentId`, `content` (with formatting markers)
   - Output: Confirmation message
   - Implementation: Find end index, use `documents.batchUpdate` with `insertText`
   - Should parse `[H1]`, `[H2]`, `[H3]` markers and apply heading styles
   - Should parse `[text](url)` and apply link formatting

4. **`insert_after_heading`**

   - Input: `documentId`, `headingText` (to find), `content` (to insert)
   - Output: Confirmation or error if heading not found
   - Implementation: Find heading by text match, calculate insertion index, insert content

5. **`replace_section`**

   - Input: `documentId`, `headingText`, `newContent`
   - Output: Confirmation message
   - Implementation: Find heading, find section end (next same-level heading), delete range, insert new content

6. **`replace_document`**
   - Input: `documentId`, `content`
   - Output: Confirmation message
   - Implementation: Delete all content, insert new content (fallback option, loses formatting)

### Document Parser Requirements

**Reading (Docs API → Text):**

- Traverse `body.content` array
- Identify paragraphs with `HEADING_1`, `HEADING_2`, `HEADING_3` styles → prefix with `[H1]`, `[H2]`, `[H3]`
- Extract text from `textRun` elements
- Identify links in `textStyle.link.url` → format as `[text](url)`
- Handle bullet lists with `•` prefix
- Handle tables with `[TABLE]` placeholder

**Writing (Text → Docs API):**

- Parse `[H1]`, `[H2]`, `[H3]` markers to identify headings
- Parse `[text](url)` to identify links
- Generate `insertText` request for plain text
- Generate `updateParagraphStyle` requests for headings
- Generate `updateTextStyle` requests for links
- Calculate correct indices for all style applications

### Project Structure

```
mcp-gdocs/
├── package.json
├── tsconfig.json
├── cdk.json
├── credentials.json              # Git-ignored, from Google Cloud Console
├── .gitignore
├── src/
│   ├── index.ts                  # Lambda handler (entry point)
│   ├── mcp-server.ts             # MCP protocol handling + tool definitions
│   ├── google-docs.ts            # Docs API operations (read, append, insert, replace)
│   ├── google-drive.ts           # Drive API operations (list files)
│   ├── document-parser.ts        # Convert Docs structure ↔ marked text format
│   └── secrets.ts                # AWS Secrets Manager read/write with caching
├── setup/
│   └── oauth-setup.ts            # One-time OAuth flow script (runs locally)
└── infra/
    └── stack.ts                  # AWS CDK stack definition
```

### AWS Infrastructure (CDK)

- **Lambda Function:**

  - Runtime: Node.js 18.x
  - Timeout: 30 seconds
  - Memory: 512 MB
  - Environment variables: `SECRET_NAME`, `NODE_OPTIONS`
  - Log retention: 1 week

- **API Gateway:**

  - REST API with single POST endpoint `/mcp`
  - API Key authentication required
  - Usage plan with throttling (10 req/s rate, 20 burst)

- **Secrets Manager:**
  - Secret name: `mcp-gdocs-credentials`
  - Contains: `clientId`, `clientSecret`, `refreshToken`, `accessToken`, `expiryDate`
  - Lambda needs read + write permissions (write for token refresh)

### OAuth Setup Script Requirements

The setup script (`setup/oauth-setup.ts`) should:

1. Read `credentials.json` from project root (downloaded from Google Cloud Console)
2. Start local HTTP server on port 3000 for OAuth callback
3. Generate authorization URL with required scopes and `prompt: 'consent'`
4. Print URL for user to open in browser
5. Capture authorization code from callback
6. Exchange code for tokens
7. Store credentials in AWS Secrets Manager (create or update)
8. Print success message with next steps

### MCP Protocol Implementation

The server should handle these JSON-RPC methods:

- `initialize` → Return server info and capabilities
- `initialized` → Acknowledge (no-op)
- `tools/list` → Return array of tool definitions with input schemas
- `tools/call` → Execute tool and return result
- `ping` → Return empty success

Response format for tool calls:

```json
{
  "content": [{ "type": "text", "text": "Result message here" }]
}
```

Error format:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "error": { "code": -32603, "message": "Error description" }
}
```

### Key Implementation Details

**Token Refresh:**

- Google OAuth2 client should have `tokens` event handler
- When new tokens received, update Secrets Manager
- Cache credentials in memory to avoid repeated Secrets Manager calls

**Index Calculation for Edits:**

- Document indices start at 1
- Each paragraph ends with a newline character (included in index range)
- When inserting, everything after shifts down
- When deleting, everything after shifts up
- For multiple edits, work from end of document backward OR use batchUpdate which handles ordering

**Finding Section End:**

- A section ends at the next heading of same or higher level (lower number)
- If no next heading found, section ends at document end
- Use `getDocumentEndIndex` helper that returns last element's endIndex - 1

## Setup Instructions to Include in README

After project generation, the workflow should be:

```bash
# 1. Install dependencies
npm install

# 2. Google Cloud Setup
#    - Go to console.cloud.google.com
#    - Create project (or use existing)
#    - Enable "Google Docs API" and "Google Drive API"
#    - Go to APIs & Services > Credentials
#    - Create OAuth 2.0 Client ID (Desktop app type)
#    - Download JSON and save as credentials.json in project root

# 3. Configure AWS CLI (if not done)
aws configure

# 4. Run OAuth setup (opens browser for Google login)
npm run setup

# 5. Bootstrap CDK (first time only)
npx cdk bootstrap

# 6. Deploy to AWS
npm run deploy

# 7. Get API key value (note the ApiKeyId from deploy output)
aws apigateway get-api-key --api-key <ApiKeyId> --include-value --query 'value' --output text

# 8. Configure Claude with the endpoint URL and API key
```

## Testing Commands to Include

```bash
# Set variables
ENDPOINT="https://xxx.execute-api.region.amazonaws.com/v1/mcp"
KEY="your-api-key"

# Test initialize
curl -X POST "$ENDPOINT" -H "x-api-key: $KEY" -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize"}'

# Test list tools
curl -X POST "$ENDPOINT" -H "x-api-key: $KEY" -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'

# Test list documents
curl -X POST "$ENDPOINT" -H "x-api-key: $KEY" -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"list_documents","arguments":{"query":"Vietnam"}}}'

# Test read document
curl -X POST "$ENDPOINT" -H "x-api-key: $KEY" -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"read_document","arguments":{"documentId":"YOUR_DOC_ID"}}}'

# Test append content
curl -X POST "$ENDPOINT" -H "x-api-key: $KEY" -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"append_content","arguments":{"documentId":"YOUR_DOC_ID","content":"[H2] Test Section\n\nThis is a test with a [link](https://google.com)."}}}'
```

## Task

Please create this complete project with all files. Make sure to:

1. Create proper `package.json` with all dependencies and scripts (`build`, `setup`, `deploy`)
2. Create `tsconfig.json` configured for Node.js Lambda
3. Create `cdk.json` pointing to the infrastructure stack
4. Create `.gitignore` that excludes `node_modules`, `dist`, `credentials.json`, `cdk.out`
5. Implement all source files in `src/` with proper TypeScript types
6. Implement the OAuth setup script in `setup/`
7. Implement the CDK stack in `infra/`
8. Create a `README.md` with setup instructions and usage examples

Focus on clean, working code. Handle errors appropriately. Add helpful console.log statements for debugging. The code should work when deployed to AWS Lambda.
