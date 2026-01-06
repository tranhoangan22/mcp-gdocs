#!/usr/bin/env node
import * as path from "node:path";
import * as cdk from "aws-cdk-lib";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as iam from "aws-cdk-lib/aws-iam";
import { Runtime } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as wafv2 from "aws-cdk-lib/aws-wafv2";
import type { Construct } from "constructs";

const SECRET_NAME = "mcp-gdocs-credentials";

/**
 * Claude's IP addresses for MCP server connections (outbound from Claude).
 * Source: https://docs.anthropic.com/en/api/ip-addresses
 *
 * SECURITY NOTE: This stack uses IP allowlisting instead of API key authentication
 * because Claude's connector system doesn't support custom x-api-key headers.
 * Only requests from Claude's IP ranges will be accepted.
 */
const CLAUDE_IP_RANGES = [
  "160.79.104.0/21", // Primary outbound range
  // Legacy IPs (phasing out after Jan 15, 2026)
  "34.162.46.92/32",
  "34.162.102.82/32",
  "34.162.136.91/32",
  "34.162.142.92/32",
  "34.162.183.95/32",
];

class McpGDocsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Reference the existing secret (created by setup script)
    const secret = secretsmanager.Secret.fromSecretNameV2(
      this,
      "GoogleCredentials",
      SECRET_NAME,
    );

    // Create the Lambda function with bundling (includes node_modules)
    const mcpLambda = new NodejsFunction(this, "McpGDocsFunction", {
      entry: path.join(__dirname, "../src/index.ts"),
      handler: "handler",
      runtime: Runtime.NODEJS_18_X,
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      environment: {
        SECRET_NAME: SECRET_NAME,
        NODE_OPTIONS: "--enable-source-maps",
      },
      logRetention: logs.RetentionDays.ONE_WEEK,
      description: "MCP server for Google Docs editing",
      bundling: {
        minify: true,
        sourceMap: true,
        target: "node18",
        // Exclude AWS SDK v3 (already available in Lambda runtime)
        externalModules: [],
      },
    });

    // Grant Lambda permission to read and write the secret
    // (write is needed for token refresh)
    secret.grantRead(mcpLambda);
    secret.grantWrite(mcpLambda);

    // Also need to grant PutSecretValue explicitly
    mcpLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["secretsmanager:PutSecretValue"],
        resources: [secret.secretArn],
      }),
    );

    // Create WAF IP Set for Claude's IP addresses
    const claudeIpSet = new wafv2.CfnIPSet(this, "ClaudeIpSet", {
      name: "claude-mcp-ip-allowlist",
      scope: "REGIONAL",
      ipAddressVersion: "IPV4",
      addresses: CLAUDE_IP_RANGES,
      description: "Claude IP addresses for MCP server connections",
    });

    // Create WAF Web ACL that only allows Claude's IPs
    const webAcl = new wafv2.CfnWebACL(this, "McpWafAcl", {
      name: "mcp-gdocs-waf",
      scope: "REGIONAL",
      defaultAction: { block: {} }, // Block all by default
      description:
        "WAF for MCP Google Docs API - allows only Claude IP addresses",
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        metricName: "mcp-gdocs-waf",
        sampledRequestsEnabled: true,
      },
      rules: [
        {
          name: "AllowClaudeIPs",
          priority: 1,
          action: { allow: {} },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: "AllowClaudeIPs",
            sampledRequestsEnabled: true,
          },
          statement: {
            ipSetReferenceStatement: {
              arn: claudeIpSet.attrArn,
            },
          },
        },
      ],
    });

    // Create API Gateway REST API (authless - protected by WAF IP allowlist)
    const api = new apigateway.RestApi(this, "McpGDocsApi", {
      restApiName: "MCP Google Docs API",
      description:
        "API Gateway for MCP Google Docs server (authless, protected by WAF IP allowlist)",
      deployOptions: {
        stageName: "v1",
        throttlingRateLimit: 10,
        throttlingBurstLimit: 20,
      },
      // Enable CORS
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: ["POST", "OPTIONS"],
        allowHeaders: ["Content-Type"],
      },
    });

    // Associate WAF Web ACL with API Gateway
    new wafv2.CfnWebACLAssociation(this, "WafAssociation", {
      resourceArn: api.deploymentStage.stageArn,
      webAclArn: webAcl.attrArn,
    });

    // Create /mcp/{token} endpoint
    const mcpResource = api.root.addResource("mcp");
    const tokenResource = mcpResource.addResource("{token}");

    // Add POST method with Lambda integration (protected by WAF + secret token in path)
    tokenResource.addMethod(
      "POST",
      new apigateway.LambdaIntegration(mcpLambda, {
        proxy: true,
      }),
      {
        apiKeyRequired: false,
      },
    );

    // Outputs
    new cdk.CfnOutput(this, "ApiEndpoint", {
      value: `${api.url}mcp/<YOUR_SECRET_TOKEN>`,
      description:
        "MCP API endpoint URL (replace <YOUR_SECRET_TOKEN> with token from setup)",
    });

    new cdk.CfnOutput(this, "LambdaFunctionName", {
      value: mcpLambda.functionName,
      description: "Lambda function name",
    });

    new cdk.CfnOutput(this, "SecurityNote", {
      value:
        "This endpoint uses IP allowlisting (WAF) instead of API keys. Only Claude's IP addresses can access it.",
      description: "Security configuration note",
    });
  }
}

// Create the CDK app and stack
const app = new cdk.App();
new McpGDocsStack(app, "McpGDocsStack", {
  description: "MCP server for Google Docs editing via Claude Mobile",
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});
