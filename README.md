# MCP Server for Google Docs

An MCP server that enables Claude to read and edit Google Docs in your Google Drive.

## Features

- **Read/Write Documents**: Full document editing with preserved structure
- **Section Operations**: Read, replace, or delete specific sections by heading
- **Search & Replace**: Find and replace text throughout documents
- **Batch Operations**: Execute multiple edits in a single call

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Claude Mobile  │────▶│     AWS WAF      │────▶│   API Gateway    │────▶│  Google APIs    │
│    or Desktop   │◀────│  (IP allowlist)  │◀────│  /mcp/{token}    │◀────│  Docs + Drive   │
└─────────────────┘     └──────────────────┘     └────────┬─────────┘     └─────────────────┘
                                                         │
                                                         ▼
                                                ┌──────────────────┐
                                                │     Lambda       │
                                                │  (validates      │
                                                │   token + calls  │
                                                │   Google APIs)   │
                                                └────────┬─────────┘
                                                         │
                                                         ▼
                                                ┌──────────────────┐
                                                │ Secrets Manager  │
                                                │ (Google OAuth +  │
                                                │  secret token)   │
                                                └──────────────────┘
```

### Security: Defense in Depth

Two layers protect your Google Docs from unauthorized access:

| Layer            | What it does                                          | Protects against                         |
| ---------------- | ----------------------------------------------------- | ---------------------------------------- |
| **WAF**          | Only allows Claude's IP addresses (`160.79.104.0/21`) | Bots, scanners, random attackers         |
| **Secret Token** | URL path contains a 64-char token only you know       | Other Claude users who discover your URL |

Even if someone finds your API Gateway URL, they need **both**:

1. To be connecting through Claude (WAF check)
2. To know your secret token (path validation)

## Prerequisites

- Node.js 18+
- AWS Account with CLI configured
- Google Cloud Account

## Quick Setup

### 1. Install & Configure Google Cloud

```bash
npm install
```

1. Create a project at [Google Cloud Console](https://console.cloud.google.com)
2. Enable **Google Docs API** and **Google Drive API**
3. Configure OAuth consent screen (add yourself as test user)
4. Create OAuth credentials (Desktop app) → download as `credentials.json`

### 2. Configure AWS CLI

```bash
aws configure
```

### 3. Run OAuth Setup

```bash
npm run setup
```

**Save the secret token displayed at the end!**

### 4. Deploy

```bash
npx cdk bootstrap  # First time only
npm run deploy
```

### 5. Configure Claude

Add a custom connector in Claude with URL:

```
https://<api-id>.execute-api.<region>.amazonaws.com/v1/mcp/<YOUR_SECRET_TOKEN>
```

Replace `<YOUR_SECRET_TOKEN>` with the token from step 3.

## Document Formatting

**Reading**: Documents use markers like `[H1]`, `[H2]`, `[text](url)`, `•` for bullets.

**Writing**: Use the same markers:

```
[H2] My Section

Paragraph with a [link](https://example.com).

• Bullet point
```

## Cleanup

```bash
npm run destroy
aws secretsmanager delete-secret --secret-id mcp-gdocs-credentials --force-delete-without-recovery
```

## License

MIT
