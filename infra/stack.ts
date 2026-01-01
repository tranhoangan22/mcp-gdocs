#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as logs from "aws-cdk-lib/aws-logs";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";
import * as path from "path";

const SECRET_NAME = "mcp-gdocs-credentials";

class McpGDocsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Reference the existing secret (created by setup script)
    const secret = secretsmanager.Secret.fromSecretNameV2(
      this,
      "GoogleCredentials",
      SECRET_NAME
    );

    // Create the Lambda function
    const mcpLambda = new lambda.Function(this, "McpGDocsFunction", {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "../dist/src")),
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      environment: {
        SECRET_NAME: SECRET_NAME,
        NODE_OPTIONS: "--enable-source-maps",
      },
      logRetention: logs.RetentionDays.ONE_WEEK,
      description: "MCP server for Google Docs editing",
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
      })
    );

    // Create API Gateway REST API
    const api = new apigateway.RestApi(this, "McpGDocsApi", {
      restApiName: "MCP Google Docs API",
      description: "API Gateway for MCP Google Docs server",
      deployOptions: {
        stageName: "v1",
        throttlingRateLimit: 10,
        throttlingBurstLimit: 20,
      },
      // Enable CORS
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: ["POST", "OPTIONS"],
        allowHeaders: ["Content-Type", "x-api-key"],
      },
    });

    // Create API key for authentication
    const apiKey = new apigateway.ApiKey(this, "McpGDocsApiKey", {
      apiKeyName: "mcp-gdocs-api-key",
      description: "API key for MCP Google Docs server",
      enabled: true,
    });

    // Create usage plan with throttling
    const usagePlan = new apigateway.UsagePlan(this, "McpGDocsUsagePlan", {
      name: "MCP Google Docs Usage Plan",
      description: "Usage plan for MCP Google Docs API",
      throttle: {
        rateLimit: 10,
        burstLimit: 20,
      },
      apiStages: [
        {
          api: api,
          stage: api.deploymentStage,
        },
      ],
    });

    // Associate API key with usage plan
    usagePlan.addApiKey(apiKey);

    // Create /mcp endpoint
    const mcpResource = api.root.addResource("mcp");

    // Add POST method with Lambda integration and API key requirement
    mcpResource.addMethod(
      "POST",
      new apigateway.LambdaIntegration(mcpLambda, {
        proxy: true,
      }),
      {
        apiKeyRequired: true,
      }
    );

    // Outputs
    new cdk.CfnOutput(this, "ApiEndpoint", {
      value: `${api.url}mcp`,
      description: "MCP API endpoint URL",
    });

    new cdk.CfnOutput(this, "ApiKeyId", {
      value: apiKey.keyId,
      description:
        "API Key ID (use 'aws apigateway get-api-key --api-key <id> --include-value' to get the value)",
    });

    new cdk.CfnOutput(this, "LambdaFunctionName", {
      value: mcpLambda.functionName,
      description: "Lambda function name",
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
