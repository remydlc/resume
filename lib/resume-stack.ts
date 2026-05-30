import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigatewayIntegrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as cloudfrontOrigins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as route53targets from 'aws-cdk-lib/aws-route53-targets';
import * as path from 'path';
import { Construct } from 'constructs';

export class ResumeStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ===== Phase 2: Storage & State Layer =====

    // DynamoDB Table for Visitor Counter
    const visitorCounterTable = new dynamodb.Table(this, 'VisitorCounterTable', {
      tableName: 'ResumeVisitorCounter',
      partitionKey: {
        name: 'id',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN, // Keep data on stack deletion
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
    });

    // Initialize the counter item (this is informational; actual init happens via Lambda)
    cdk.Tags.of(visitorCounterTable).add('InitialItem', 'id=total_visitors, count=0');

    // S3 Bucket for Frontend (Import existing bucket)
    const frontendBucket = s3.Bucket.fromBucketName(this, 'FrontendBucket', 'resume.nine3one2.com');

    // ===== Phase 3: Compute & API Layer =====

    // Lambda Function (Go)
    const counterLambda = new lambda.Function(this, 'CounterFunction', {
      functionName: 'resume-counter',
      runtime: lambda.Runtime.PROVIDED_AL2023,
      handler: 'bootstrap',
      code: lambda.Code.fromAsset(path.join(__dirname, '../src/backend/counter')),
      architecture: lambda.Architecture.ARM_64, // Graviton2 for cost optimization
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: {
        TABLE_NAME: visitorCounterTable.tableName,
      },
      description: 'Lambda function to increment resume visitor counter',
    });

    // Grant Lambda read/write access to DynamoDB
    visitorCounterTable.grantReadWriteData(counterLambda);

    // HTTP API Gateway
    const httpApi = new apigateway.HttpApi(this, 'ResumeApi', {
      apiName: 'resume-counter-api',
      description: 'HTTP API for resume visitor counter',
      corsPreflight: {
        allowOrigins: ['https://resume.nine3one2.com'],
        allowMethods: [apigateway.CorsHttpMethod.GET, apigateway.CorsHttpMethod.OPTIONS],
        allowHeaders: ['Content-Type'],
        maxAge: cdk.Duration.hours(24),
      },
    });

    // API Route: GET /counter
    httpApi.addRoutes({
      path: '/counter',
      methods: [apigateway.HttpMethod.GET],
      integration: new apigatewayIntegrations.HttpLambdaIntegration(
        'CounterIntegration',
        counterLambda
      ),
    });

    // ===== Phase 4: Route 53 Hosted Zone Lookup =====
    // This will be used in Phase 4 for CloudFront DNS record

    const hostedZone = route53.HostedZone.fromLookup(this, 'HostedZone', {
      domainName: 'nine3one2.com',
    });

    // ===== Phase 4: Edge Routing & Security =====

    // ACM Certificate (must be in us-east-1 for CloudFront)
    const certificate = new acm.Certificate(this, 'ResumeCertificate', {
      domainName: 'resume.nine3one2.com',
      validation: acm.CertificateValidation.fromDns(hostedZone),
    });

    // Origin Access Control (OAC) for S3
    const oac = new cloudfront.S3OriginAccessControl(this, 'ResumeOAC', {
      description: 'OAC for resume.nine3one2.com S3 bucket',
    });

    // CloudFront Distribution
    const distribution = new cloudfront.Distribution(this, 'ResumeDistribution', {
      defaultBehavior: {
        origin: new cloudfrontOrigins.S3Origin(frontendBucket, {
          originAccessControlId: oac.originAccessControlId,
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        compress: true,
      },
      domainNames: ['resume.nine3one2.com'],
      certificate: certificate,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100, // Use only North America & Europe
      defaultRootObject: 'index.html',
      errorResponses: [
        {
          httpStatus: 404,
          responseHttpStatus: 404,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.minutes(5),
        },
        {
          httpStatus: 403,
          responseHttpStatus: 403,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.minutes(5),
        },
      ],
    });

    // Update S3 bucket policy to allow CloudFront OAC access
    frontendBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        principals: [new iam.ServicePrincipal('cloudfront.amazonaws.com')],
        actions: ['s3:GetObject'],
        resources: [`${frontendBucket.bucketArn}/*`],
        conditions: {
          StringEquals: {
            'AWS:SourceArn': `arn:aws:cloudfront::${cdk.Stack.of(this).account}:distribution/${distribution.distributionId}`,
          },
        },
      })
    );

    // Route 53 A Record (IPv4) pointing to CloudFront
    new route53.ARecord(this, 'ResumeARecord', {
      zone: hostedZone,
      recordName: 'resume',
      target: route53.RecordTarget.fromAlias(
        new route53targets.CloudFrontTarget(distribution)
      ),
    });

    // Route 53 AAAA Record (IPv6) pointing to CloudFront
    new route53.AaaaRecord(this, 'ResumeAaaaRecord', {
      zone: hostedZone,
      recordName: 'resume',
      target: route53.RecordTarget.fromAlias(
        new route53targets.CloudFrontTarget(distribution)
      ),
    });

    // ===== Outputs =====

    new cdk.CfnOutput(this, 'DynamoDBTableName', {
      value: visitorCounterTable.tableName,
      description: 'DynamoDB table name for visitor counter',
      exportName: 'ResumeVisitorCounterTableName',
    });

    new cdk.CfnOutput(this, 'DynamoDBTableArn', {
      value: visitorCounterTable.tableArn,
      description: 'DynamoDB table ARN',
      exportName: 'ResumeVisitorCounterTableArn',
    });

    new cdk.CfnOutput(this, 'FrontendBucketName', {
      value: frontendBucket.bucketName,
      description: 'S3 bucket name for frontend hosting',
      exportName: 'ResumeFrontendBucketName',
    });

    new cdk.CfnOutput(this, 'FrontendBucketArn', {
      value: frontendBucket.bucketArn,
      description: 'S3 bucket ARN',
      exportName: 'ResumeFrontendBucketArn',
    });

    new cdk.CfnOutput(this, 'HostedZoneId', {
      value: hostedZone.hostedZoneId,
      description: 'Route 53 Hosted Zone ID for nine3one2.com',
      exportName: 'ResumeHostedZoneId',
    });

    new cdk.CfnOutput(this, 'LambdaFunctionArn', {
      value: counterLambda.functionArn,
      description: 'ARN of the counter Lambda function',
      exportName: 'ResumeCounterLambdaArn',
    });

    new cdk.CfnOutput(this, 'ApiGatewayEndpoint', {
      value: httpApi.url || '',
      description: 'HTTP API Gateway endpoint URL',
      exportName: 'ResumeApiEndpoint',
    });

    new cdk.CfnOutput(this, 'CloudFrontDomainName', {
      value: distribution.domainName,
      description: 'CloudFront distribution domain name',
      exportName: 'ResumeCloudFrontDomain',
    });

    new cdk.CfnOutput(this, 'CloudFrontDistributionId', {
      value: distribution.distributionId,
      description: 'CloudFront distribution ID (for cache invalidation)',
      exportName: 'ResumeDistributionId',
    });

    new cdk.CfnOutput(this, 'ResumeWebsiteUrl', {
      value: 'https://resume.nine3one2.com',
      description: 'Resume website URL',
    });

    // Store references for use in other stacks (if needed)
    this.visitorCounterTable = visitorCounterTable;
    this.frontendBucket = frontendBucket;
    this.hostedZone = hostedZone;
    this.counterLambda = counterLambda;
    this.httpApi = httpApi;
    this.distribution = distribution;
  }

  public visitorCounterTable: dynamodb.Table;
  public frontendBucket: s3.IBucket;
  public hostedZone: route53.IHostedZone;
  public counterLambda: lambda.Function;
  public httpApi: apigateway.HttpApi;
  public distribution: cloudfront.Distribution;
}
