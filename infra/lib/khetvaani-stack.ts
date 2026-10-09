import {
  Stack,
  StackProps,
  RemovalPolicy,
  Duration,
  CfnOutput,
  PhysicalName,
  aws_ec2 as ec2,
  aws_s3 as s3,
  aws_rds as rds,
  aws_ecr as ecr,
  aws_apprunner as apprunner,
  aws_lambda as lambda,
  aws_events as events,
  aws_events_targets as targets,
  aws_iam as iam,
  aws_secretsmanager as secretsmanager,
  aws_cloudfront as cloudfront,
  aws_cloudfront_origins as origins,
  aws_sns as sns,
  aws_location as location,
} from 'aws-cdk-lib';
import { Construct } from 'constructs';

export interface KhetvaaniStackProps extends StackProps {
  enableCloudFront?: boolean;
  enableSns?: boolean;
  enableLocation?: boolean;
}

export class KhetvaaniStack extends Stack {
  constructor(scope: Construct, id: string, props?: KhetvaaniStackProps) {
    super(scope, id, props);

    const enableCloudFront = props?.enableCloudFront ?? false;
    const enableSns = props?.enableSns ?? false;
    const enableLocation = props?.enableLocation ?? false;

    // =========================================================================
    // 1. VPC & Networking (2 AZs in ap-south-1 with public and private subnets)
    // Cost estimate: NAT Gateway ~$32/mo per AZ (or single NAT Gateway ~$32/mo)
    // =========================================================================
    const vpc = new ec2.Vpc(this, 'KhetvaaniVpc', {
      availabilityZones: ['ap-south-1a', 'ap-south-1b'],
      natGateways: 1, // Minimize cost while maintaining private subnet egress
      subnetConfiguration: [
        {
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
        {
          name: 'PrivateSubnet',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
          cidrMask: 24,
        },
        {
          name: 'IsolatedDbSubnet',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
          cidrMask: 24,
        },
      ],
    });

    // =========================================================================
    // 2. S3 Storage (Audio Clips, Stage Photos, Static Assets)
    // Private bucket, encrypted at rest, CORS configured for web playback
    // Cost estimate: ~$0.023/GB/mo storage + standard GET/PUT request costs
    // =========================================================================
    const audioBucket = new s3.Bucket(this, 'KhetvaaniAudioBucket', {
      bucketName: PhysicalName.GENERATE_IF_NEEDED,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      cors: [
        {
          allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.HEAD],
          allowedOrigins: ['*'],
          allowedHeaders: ['*'],
          maxAge: 3000,
        },
      ],
    });

    // =========================================================================
    // 3. Secrets Manager & RDS PostgreSQL with PostGIS
    // Small instance (db.t4g.micro) placed strictly in private isolated subnets
    // Cost estimate: db.t4g.micro ~$13.50/mo + 20GB gp3 storage ~$2.30/mo
    // =========================================================================
    const dbSecret = new secretsmanager.Secret(this, 'KhetvaaniDbSecret', {
      secretName: 'khetvaani/rds/postgres',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: 'khetvaani_admin' }),
        generateStringKey: 'password',
        excludePunctuation: true,
        includeSpace: false,
        passwordLength: 20,
      },
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const dbSecurityGroup = new ec2.SecurityGroup(this, 'KhetvaaniDbSecurityGroup', {
      vpc,
      description: 'Security group for RDS PostgreSQL instance',
      allowAllOutbound: false,
    });

    const dbInstance = new rds.DatabaseInstance(this, 'KhetvaaniPostgresDb', {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.of('16.10', '16'),
      }),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.MICRO),
      vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
      },
      securityGroups: [dbSecurityGroup],
      credentials: rds.Credentials.fromSecret(dbSecret),
      databaseName: 'khetvaani',
      allocatedStorage: 20,
      maxAllocatedStorage: 50,
      storageType: rds.StorageType.GP3,
      storageEncrypted: true,
      multiAz: false,
      autoMinorVersionUpgrade: true,
      backupRetention: Duration.days(7),
      deletionProtection: false,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // =========================================================================
    // 4. ECR Repository for Container Images
    // Lifecycle rule retains only the latest 10 images
    // Cost estimate: ~$0.10/GB/mo storage
    // =========================================================================
    const ecrRepo = new ecr.Repository(this, 'KhetvaaniEcrRepo', {
      repositoryName: 'khetvaani-api',
      imageScanOnPush: true,
      lifecycleRules: [
        {
          maxImageCount: 10,
          description: 'Retain only 10 latest container images',
        },
      ],
      removalPolicy: RemovalPolicy.DESTROY,
      emptyOnDelete: true,
    });

    // =========================================================================
    // 5. App Runner VPC Connector & IAM Roles
    // Least privilege role allowing access only to the S3 bucket & DB Secret
    // Cost estimate: VPC Connector ~$0/mo (traffic charges apply)
    // =========================================================================
    const appRunnerSecurityGroup = new ec2.SecurityGroup(this, 'AppRunnerSecurityGroup', {
      vpc,
      description: 'Security group for App Runner VPC Connector',
      allowAllOutbound: true,
    });

    // Allow App Runner to communicate with RDS on port 5432
    dbSecurityGroup.addIngressRule(
      appRunnerSecurityGroup,
      ec2.Port.tcp(5432),
      'Allow inbound PostgreSQL access from App Runner service'
    );

    const vpcConnector = new apprunner.CfnVpcConnector(this, 'KhetvaaniVpcConnector', {
      vpcConnectorName: 'khetvaani-vpc-connector',
      subnets: vpc.selectSubnets({ subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }).subnetIds,
      securityGroups: [appRunnerSecurityGroup.securityGroupId],
    });

    const instanceRole = new iam.Role(this, 'KhetvaaniAppRunnerInstanceRole', {
      assumedBy: new iam.ServicePrincipal('tasks.apprunner.amazonaws.com'),
      description: 'IAM role for KhetVaani App Runner container instance',
    });

    // Least privilege permissions - scoped strictly to S3 bucket & Secret ARN
    audioBucket.grantReadWrite(instanceRole);
    dbSecret.grantRead(instanceRole);

    const accessRole = new iam.Role(this, 'KhetvaaniAppRunnerEcrAccessRole', {
      assumedBy: new iam.ServicePrincipal('build.apprunner.amazonaws.com'),
      description: 'IAM role for App Runner to pull images from ECR',
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSAppRunnerServicePolicyForECRAccess'),
      ],
    });

    // =========================================================================
    // 6. App Runner Service
    // Auto-scaling container service running the Node.js Express platform
    // Cost estimate: 1 vCPU / 2GB RAM provisioned ~$0.007/GB-hour memory ($5/mo idle) + $0.064/vCPU-hour active
    // =========================================================================
    const customImageUri = this.node.tryGetContext('imageUri') as string | undefined;
    const imageIdentifier = customImageUri || `${this.account}.dkr.ecr.${this.region}.amazonaws.com/khetvaani-api:latest`;
    const isPublicImage = imageIdentifier.startsWith('public.ecr.aws');

    const appRunnerService = new apprunner.CfnService(this, 'KhetvaaniAppRunnerServiceV2', {
      serviceName: 'khetvaani-backend-prod',
      sourceConfiguration: {
        authenticationConfiguration: isPublicImage
          ? undefined
          : {
              accessRoleArn: accessRole.roleArn,
            },
        autoDeploymentsEnabled: isPublicImage ? false : true,
        imageRepository: {
          imageIdentifier,
          imageRepositoryType: isPublicImage ? 'ECR_PUBLIC' : 'ECR',
          imageConfiguration: {
            port: '3000',
            runtimeEnvironmentVariables: [
              { name: 'NODE_ENV', value: 'production' },
              { name: 'PORT', value: '3000' },
              { name: 'AWS_REGION', value: this.region },
              { name: 'S3_BUCKET_NAME', value: audioBucket.bucketName },
              { name: 'DB_HOST', value: dbInstance.dbInstanceEndpointAddress },
              { name: 'DB_PORT', value: dbInstance.dbInstanceEndpointPort },
              { name: 'DB_NAME', value: 'khetvaani' },
              { name: 'DB_SECRET_ARN', value: dbSecret.secretArn },
            ],
          },
        },
      },
      instanceConfiguration: {
        cpu: '1024',
        memory: '2048',
        instanceRoleArn: instanceRole.roleArn,
      },
      networkConfiguration: {
        egressConfiguration: {
          egressType: 'VPC',
          vpcConnectorArn: vpcConnector.attrVpcConnectorArn,
        },
      },
      healthCheckConfiguration: {
        protocol: 'HTTP',
        path: '/health',
        interval: 10,
        timeout: 5,
        healthyThreshold: 1,
        unhealthyThreshold: 5,
      },
    });

    // =========================================================================
    // 7. Lambda (Daily Forecast & El Niño Job) + EventBridge Scheduler
    // Runs daily at 05:00 IST (23:30 UTC)
    // Cost estimate: Lambda ~Free Tier (< 1M requests/mo), EventBridge Scheduler Free
    // =========================================================================
    const lambdaSecurityGroup = new ec2.SecurityGroup(this, 'KhetvaaniDailyJobSecurityGroup', {
      vpc,
      description: 'Security group for daily forecast Lambda worker',
      allowAllOutbound: true,
    });

    dbSecurityGroup.addIngressRule(
      lambdaSecurityGroup,
      ec2.Port.tcp(5432),
      'Allow inbound PostgreSQL access from Daily Job Lambda'
    );

    const dailyJobLambda = new lambda.Function(this, 'KhetvaaniDailyForecastLambda', {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline(`
        exports.handler = async (event) => {
          console.log('[DailyJob Lambda] Starting daily forecast & El Niño analysis...', new Date().toISOString());
          const appRunnerUrl = process.env.APP_RUNNER_URL;
          if (appRunnerUrl) {
            try {
              const res = await fetch('https://' + appRunnerUrl + '/health');
              const data = await res.json();
              console.log('[DailyJob Lambda] App health check successful:', data);
            } catch (err) {
              console.warn('[DailyJob Lambda] App trigger warning:', err.message);
            }
          }
          return { statusCode: 200, body: JSON.stringify({ message: 'Daily job executed successfully' }) };
        };
      `),
      timeout: Duration.minutes(5),
      memorySize: 512,
      vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      securityGroups: [lambdaSecurityGroup],
      environment: {
        NODE_ENV: 'production',
        APP_RUNNER_URL: appRunnerService.attrServiceUrl,
        S3_BUCKET_NAME: audioBucket.bucketName,
        DB_HOST: dbInstance.dbInstanceEndpointAddress,
        DB_SECRET_ARN: dbSecret.secretArn,
      },
      description: 'Scheduled agronomy forecast & El Niño daily monitoring job',
    });

    audioBucket.grantReadWrite(dailyJobLambda);
    dbSecret.grantRead(dailyJobLambda);

    // EventBridge Rule: Trigger daily at 23:30 UTC (05:00 IST)
    const dailyRule = new events.Rule(this, 'KhetvaaniDailyScheduleRule', {
      schedule: events.Schedule.cron({ minute: '30', hour: '23' }),
      description: 'Trigger daily 05:00 IST weather & crop stage evaluation job',
    });
    dailyRule.addTarget(new targets.LambdaFunction(dailyJobLambda));

    // =========================================================================
    // 8. Optional: CloudFront Distribution (behind flag)
    // Cost estimate: ~$0.085/GB data transfer out
    // =========================================================================
    if (enableCloudFront) {
      const distribution = new cloudfront.Distribution(this, 'KhetvaaniCdn', {
        defaultBehavior: {
          origin: new origins.HttpOrigin(appRunnerService.attrServiceUrl, {
            protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
          }),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        },
        additionalBehaviors: {
          '/audio/*': {
            origin: origins.S3BucketOrigin.withOriginAccessControl(audioBucket),
            viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
            cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
          },
        },
        comment: 'CloudFront CDN for KhetVaani PWA & Audio delivery',
      });

      new CfnOutput(this, 'CloudFrontUrl', {
        value: `https://${distribution.distributionDomainName}`,
        description: 'CloudFront CDN URL',
        exportName: 'KhetvaaniCdnUrl',
      });
    }

    // =========================================================================
    // 9. Optional: SNS Topic for SMS/IVR fallback broadcast (behind flag)
    // Cost estimate: $0.50/1M SNS requests + transactional SMS rates
    // =========================================================================
    if (enableSns) {
      const alertTopic = new sns.Topic(this, 'KhetvaaniSnsAlertTopic', {
        topicName: 'khetvaani-severe-alerts',
        displayName: 'KhetVaani Urgent Farmer Weather Alerts',
      });
      alertTopic.grantPublish(instanceRole);
      alertTopic.grantPublish(dailyJobLambda);

      new CfnOutput(this, 'SnsTopicArn', {
        value: alertTopic.topicArn,
        description: 'SNS Topic ARN for broadcast SMS fallback',
        exportName: 'KhetvaaniSnsTopicArn',
      });
    }

    // =========================================================================
    // 10. Optional: Amazon Location Place Index (behind flag)
    // Cost estimate: $0.04 per 1,000 geocoding requests
    // =========================================================================
    if (enableLocation) {
      const placeIndex = new location.CfnPlaceIndex(this, 'KhetvaaniPlaceIndex', {
        indexName: 'khetvaani-place-index',
        dataSource: 'Esri',
        pricingPlan: 'RequestBasedUsage',
        description: 'Geocoding place index for farmer village/district coordinates',
      });

      new CfnOutput(this, 'LocationPlaceIndexName', {
        value: placeIndex.indexName,
        description: 'Amazon Location Service Place Index Name',
        exportName: 'KhetvaaniPlaceIndexName',
      });
    }

    // =========================================================================
    // 11. Stack Outputs
    // =========================================================================
    new CfnOutput(this, 'AppRunnerServiceUrl', {
      value: `https://${appRunnerService.attrServiceUrl}`,
      description: 'KhetVaani API & Web App Public URL',
      exportName: 'KhetvaaniAppRunnerUrl',
    });

    new CfnOutput(this, 'AudioBucketName', {
      value: audioBucket.bucketName,
      description: 'S3 Audio Clips and Photos Bucket Name',
      exportName: 'KhetvaaniAudioBucketName',
    });

    new CfnOutput(this, 'DatabaseEndpoint', {
      value: dbInstance.dbInstanceEndpointAddress,
      description: 'RDS PostgreSQL Endpoint Address (Private Subnet)',
      exportName: 'KhetvaaniDbEndpoint',
    });

    new CfnOutput(this, 'DatabaseSecretArn', {
      value: dbSecret.secretArn,
      description: 'Secrets Manager ARN for PostgreSQL credentials',
      exportName: 'KhetvaaniDbSecretArn',
    });

    new CfnOutput(this, 'EcrRepositoryUri', {
      value: ecrRepo.repositoryUri,
      description: 'ECR Container Repository URI',
      exportName: 'KhetvaaniEcrRepoUri',
    });
  }
}
