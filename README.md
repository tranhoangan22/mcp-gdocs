# MCP Server for Google Docs

An MCP (Model Context Protocol) server that enables Claude on iOS to read and edit Google Docs stored in your Google Drive. Have conversations with Claude on your phone and let it directly edit your documents without copy-pasting.

## Features

- **List Documents**: Search and list Google Docs in your Drive
- **Read Documents**: View document content with preserved structure (headings, links)
- **Append Content**: Add content to the end of a document
- **Insert After Heading**: Add content after a specific heading
- **Replace Section**: Replace content under a heading while preserving the heading
- **Replace Document**: Full document replacement (fallback option)

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

### How It Works

1. **Claude Mobile** sends MCP tool requests to your AWS endpoint
2. **API Gateway** validates the API key and forwards requests to Lambda
3. **Lambda** retrieves Google OAuth tokens from Secrets Manager
4. **Lambda** calls Google Docs/Drive APIs to read or edit documents
5. Results flow back through the chain to Claude

## Prerequisites

- **Node.js 18+** - Runtime for building and running the setup scripts
- **AWS Account** - For hosting the Lambda function and API Gateway
- **Google Cloud Account** - For accessing Google Docs and Drive APIs

---

## Setup Guide

### Step 1: Install Dependencies

```bash
npm install
```

**Why this step?**
This installs all the npm packages needed for:
- `googleapis` - Google's official API client library for accessing Docs and Drive
- `@aws-sdk/client-secrets-manager` - AWS SDK for storing/retrieving OAuth tokens
- `aws-cdk-lib` - Infrastructure-as-code framework for deploying to AWS
- TypeScript compiler and type definitions

---

### Step 2: Google Cloud Setup

This step creates OAuth credentials that allow your server to access Google Docs on your behalf.

#### 2.1 Create a Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Click the project dropdown at the top → **New Project**
3. Name it something like `mcp-gdocs` and click **Create**
4. Wait for the project to be created, then select it

**Why?** Google requires all API access to be associated with a project. This project will contain your OAuth credentials and track your API usage.

#### 2.2 Enable Required APIs

1. Go to **APIs & Services** → **Library**
2. Search for and enable these APIs:
   - **Google Docs API** - Required to read and edit document content
   - **Google Drive API** - Required to list and search for documents

**Why?** Google APIs are disabled by default. You must explicitly enable each API you want to use.

#### 2.3 Configure OAuth Consent Screen

1. Go to **APIs & Services** → **OAuth consent screen**
2. Select **External** user type (unless you have Google Workspace)
3. Fill in the required fields:
   - **App name**: `mcp-gdocs`
   - **User support email**: Your email
   - **Developer contact email**: Your email
4. Click **Save and Continue**
5. On the **Scopes** page, click **Add or Remove Scopes** and add:
   - `https://www.googleapis.com/auth/documents` (read/write Docs)
   - `https://www.googleapis.com/auth/drive.readonly` (list files)
6. Click **Save and Continue**
7. On the **Test users** page, click **+ Add Users**
8. Add your Google email address (e.g., `yourname@gmail.com`)
9. Click **Save and Continue**

**Why?** The consent screen is what users see when authorizing your app. Since the app isn't verified by Google (verification takes weeks and is unnecessary for personal use), you must add yourself as a "test user" to be able to authorize it.

#### 2.4 Create OAuth Credentials

1. Go to **APIs & Services** → **Credentials**
2. Click **+ Create Credentials** → **OAuth client ID**
3. Select **Desktop app** as the application type
4. Name it `mcp-gdocs-desktop`
5. Click **Create**
6. Click **Download JSON** to download your credentials
7. Rename the downloaded file to `credentials.json`
8. Move it to the root of this project directory

**Why?** The credentials file contains your `client_id` and `client_secret`. These identify your application to Google when requesting OAuth tokens. We use "Desktop app" type because the OAuth flow runs locally on your machine during setup.

---

### Step 3: Configure AWS CLI

The AWS CLI is needed to deploy your server and store secrets.

#### 3.1 Create an IAM User

1. Go to [AWS IAM Console](https://console.aws.amazon.com/iam/)
2. Click **Users** → **Create user**
3. Name it `mcp-gdocs-deployer`
4. Click **Next**
5. Select **Attach policies directly**
6. Attach the **AdministratorAccess** policy (you can restrict this later)
7. Click **Next** → **Create user**

**Why?** AWS requires credentials to deploy resources. The AdministratorAccess policy gives full permissions needed for CDK to create Lambda functions, API Gateway, IAM roles, and Secrets Manager entries.

#### 3.2 Create Access Keys

1. Click on your newly created user
2. Go to **Security credentials** tab
3. Click **Create access key**
4. Select **Command Line Interface (CLI)**
5. Check the confirmation box and click **Next** → **Create access key**
6. **Copy both the Access Key ID and Secret Access Key** (you won't see these again!)

#### 3.3 Configure the CLI

```bash
aws configure
```

Enter the following when prompted:
- **AWS Access Key ID**: Paste your access key
- **AWS Secret Access Key**: Paste your secret key
- **Default region name**: `us-east-1` (or your preferred region)
- **Default output format**: `json`

**Why?** The AWS CLI stores these credentials in `~/.aws/credentials`. All AWS SDK calls (including CDK deployments) will use these credentials to authenticate with AWS.

---

### Step 4: Run OAuth Setup

```bash
npm run setup
```

This script does the following:

1. **Reads `credentials.json`** - Loads your Google OAuth client ID and secret
2. **Generates an authorization URL** - Creates a Google OAuth URL with the required scopes
3. **Starts a local web server** - Listens on `http://localhost:8085` to catch the OAuth callback
4. **Opens your browser** - You'll see Google's consent screen asking for permission
5. **Captures the authorization code** - After you approve, Google redirects to localhost with a code
6. **Exchanges code for tokens** - Sends the code to Google to get access and refresh tokens
7. **Stores tokens in AWS Secrets Manager** - Saves all credentials securely in the cloud

**Why?**
- The **access token** is short-lived (~1 hour) and used for API calls
- The **refresh token** is long-lived and used to get new access tokens automatically
- Storing in **Secrets Manager** (instead of environment variables) is more secure and allows the Lambda to update tokens when they refresh

**Troubleshooting:**
- If port 8085 is in use, edit `setup/oauth-setup.ts` and change `REDIRECT_PORT`
- If you see "Access blocked", make sure you added yourself as a test user in Step 2.3
- If you see "No refresh token received", revoke access at [myaccount.google.com/permissions](https://myaccount.google.com/permissions) and run setup again

---

### Step 5: Bootstrap CDK

```bash
npx cdk bootstrap
```

**Why?**
CDK (Cloud Development Kit) needs some foundational AWS resources before it can deploy your stack:
- An S3 bucket to store deployment assets (Lambda code zip files)
- IAM roles that CloudFormation uses to create resources
- An ECR repository for Docker images (if needed)

This is a **one-time setup** per AWS account/region combination. You won't need to run it again for future deployments.

---

### Step 6: Deploy to AWS

```bash
npm run deploy
```

This command:
1. **Compiles TypeScript** (`npm run build`) - Converts your `.ts` files to `.js`
2. **Synthesizes CloudFormation** - CDK generates a CloudFormation template from `infra/stack.ts`
3. **Deploys to AWS** - CloudFormation creates/updates all resources

**Resources created:**
- **Lambda Function** - Your MCP server code running in the cloud
- **API Gateway** - HTTPS endpoint that routes requests to Lambda
- **API Key** - Secret key required to call your API
- **Usage Plan** - Rate limiting (10 requests/sec, 20 burst)
- **IAM Role** - Permissions for Lambda to access Secrets Manager

**Save these outputs** (you'll need them):
```
Outputs:
McpGDocsStack.ApiEndpoint = https://xxxxxxxxxx.execute-api.us-east-1.amazonaws.com/v1/mcp
McpGDocsStack.ApiKeyId = abc123xyz
McpGDocsStack.LambdaFunctionName = McpGDocsStack-McpGDocsFunction-xxxxx
```

---

### Step 7: Get Your API Key

The deploy output shows the API Key **ID**, not the actual key value. Retrieve it with:

```bash
aws apigateway get-api-key --api-key YOUR_API_KEY_ID --include-value --query 'value' --output text
```

Replace `YOUR_API_KEY_ID` with the `ApiKeyId` from the deploy output.

**Why?** API keys are stored securely in AWS. The `--include-value` flag is required to retrieve the actual key value, and your IAM user must have permission to do this.

---

### Step 8: Test Your Server

Set your variables:

```bash
ENDPOINT="https://xxxxxxxxxx.execute-api.us-east-1.amazonaws.com/v1/mcp"
KEY="your-actual-api-key-value"
```

#### Test the connection:

```bash
curl -X POST "$ENDPOINT" -H "x-api-key: $KEY" -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize"}'
```

Expected response:
```json
{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2024-11-05","capabilities":{"tools":{}},"serverInfo":{"name":"mcp-gdocs","version":"1.0.0"}}}
```

#### List your documents:

```bash
curl -X POST "$ENDPOINT" -H "x-api-key: $KEY" -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"list_documents","arguments":{}}}'
```

#### Read a specific document:

```bash
curl -X POST "$ENDPOINT" -H "x-api-key: $KEY" -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"read_document","arguments":{"documentId":"YOUR_DOC_ID"}}}'
```

---

### Step 9: Configure Claude

Add your MCP server to Claude's configuration with:
- **Endpoint URL**: The `ApiEndpoint` from deploy output
- **API Key**: The key value from Step 7

(Specific configuration steps depend on your Claude client)

---

## Document Formatting

### Reading Documents

Documents are returned with these markers:
- `[H1]`, `[H2]`, `[H3]` - Heading levels
- `[text](url)` - Hyperlinks
- `•` - Bullet points
- `[TABLE]` - Table placeholder

### Writing Content

Use the same markers when adding content:

```
[H2] My New Section

This is regular paragraph text with a [link](https://example.com).

[H3] Subsection

More content here.
```

---

## MCP Tools Reference

### list_documents

List Google Docs in your Drive.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| query | string | No | Filter documents by name |

### read_document

Read the content of a Google Doc.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| documentId | string | Yes | The Google Doc ID |

### append_content

Add content to the end of a document.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| documentId | string | Yes | The Google Doc ID |
| content | string | Yes | Content to append |

### insert_after_heading

Insert content after a specific heading.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| documentId | string | Yes | The Google Doc ID |
| headingText | string | Yes | Heading to find (partial match) |
| content | string | Yes | Content to insert |

### replace_section

Replace content under a heading.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| documentId | string | Yes | The Google Doc ID |
| headingText | string | Yes | Heading to find (partial match) |
| newContent | string | Yes | New section content |

### replace_document

Replace entire document content.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| documentId | string | Yes | The Google Doc ID |
| content | string | Yes | New document content |

---

## Troubleshooting

### "Access blocked: app has not completed Google verification"

Your Google OAuth app is in testing mode. Add yourself as a test user:
1. Go to [Google Cloud Console](https://console.cloud.google.com) → **APIs & Services** → **OAuth consent screen**
2. Scroll to **Test users** and click **+ Add Users**
3. Add your email address

### "No refresh token received"

Google only provides a refresh token on the first authorization. To get a new one:
1. Go to [myaccount.google.com/permissions](https://myaccount.google.com/permissions)
2. Find your app and click **Remove Access**
3. Run `npm run setup` again

### "Port already in use" during setup

Another process is using port 8085. Either:
- Kill the process: `lsof -ti:8085 | xargs kill -9`
- Or change `REDIRECT_PORT` in `setup/oauth-setup.ts`

### "User is not authorized to perform secretsmanager:GetSecretValue"

Your AWS IAM user needs Secrets Manager permissions:
1. Go to [IAM Console](https://console.aws.amazon.com/iam/) → **Users** → select your user
2. Click **Add permissions** → **Attach policies directly**
3. Add **SecretsManagerReadWrite** (or **AdministratorAccess** for simplicity)

### "Has the environment been bootstrapped?"

Run CDK bootstrap first:
```bash
npx cdk bootstrap
```

### Lambda timeout errors

The default timeout is 30 seconds. For large documents, increase it in `infra/stack.ts`:
```typescript
timeout: cdk.Duration.seconds(60),
```

### Cold start latency

The first request after a period of inactivity may take 3-5 seconds as Lambda initializes. Subsequent requests are faster.

---

## Cleanup

To remove all AWS resources:

```bash
npm run destroy
```

Also delete the secret in Secrets Manager:

```bash
aws secretsmanager delete-secret --secret-id mcp-gdocs-credentials --force-delete-without-recovery
```

Optionally, revoke Google access:
1. Go to [myaccount.google.com/permissions](https://myaccount.google.com/permissions)
2. Find your app and remove access

---

## Security Notes

- **credentials.json** is git-ignored and should never be committed
- **OAuth tokens** are stored in AWS Secrets Manager, not in code
- **API key** is required for all requests to your endpoint
- **HTTPS** is enforced by API Gateway
- Consider restricting your IAM user permissions after initial deployment

---

## License

MIT
