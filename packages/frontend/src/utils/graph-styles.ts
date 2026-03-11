interface ResourceTypeStyle {
  color: string;
  icon: string;
  label: string;
}

export const RESOURCE_TYPE_STYLES: Record<string, ResourceTypeStyle> = {
  EC2Instance: { color: "#FF9900", icon: "🖥️", label: "EC2 Instance" },
  EBSVolume: { color: "#8E44AD", icon: "💾", label: "EBS Volume" },
  ElasticIP: { color: "#D35400", icon: "🌐", label: "Elastic IP" },
  LoadBalancer: { color: "#2980B9", icon: "⚖️", label: "Load Balancer" },
  SecurityGroup: { color: "#E74C3C", icon: "🛡️", label: "Security Group" },
  IAMUser: { color: "#C0392B", icon: "👤", label: "IAM User" },
  IAMRole: { color: "#9B59B6", icon: "🔑", label: "IAM Role" },
  LambdaFunction: { color: "#F39C12", icon: "⚡", label: "Lambda Function" },
  RDSInstance: { color: "#1ABC9C", icon: "🗄️", label: "RDS Instance" },
  ECSService: { color: "#E67E22", icon: "📦", label: "ECS Service" },
  NATGateway: { color: "#27AE60", icon: "🔀", label: "NAT Gateway" },
  CloudWatchLogGroup: { color: "#7F8C8D", icon: "📋", label: "CloudWatch Log Group" },
  VPC: { color: "#3498DB", icon: "☁️", label: "VPC" },
  Subnet: { color: "#2ECC71", icon: "🔗", label: "Subnet" },
  SubnetGroup: { color: "#16A085", icon: "🔗", label: "Subnet Group" },
  TargetGroup: { color: "#5DADE2", icon: "🎯", label: "Target Group" },
  ECSCluster: { color: "#F1C40F", icon: "🏗️", label: "ECS Cluster" },
  S3Bucket: { color: "#27AE60", icon: "🪣", label: "S3 Bucket" },
  DynamoDBTable: { color: "#2471A3", icon: "📊", label: "DynamoDB Table" },
  SNSTopic: { color: "#A93226", icon: "📢", label: "SNS Topic" },
  SQSQueue: { color: "#D4AC0D", icon: "📬", label: "SQS Queue" },
  CloudFrontDistribution: { color: "#8E44AD", icon: "🌍", label: "CloudFront Distribution" },
  APIGatewayRestAPI: { color: "#2E86C1", icon: "🔌", label: "API Gateway REST API" },
  APIGatewayHttpAPI: { color: "#2E86C1", icon: "🔌", label: "API Gateway HTTP API" },
  AutoScalingGroup: { color: "#E67E22", icon: "📈", label: "Auto Scaling Group" },
  StepFunction: { color: "#E74C3C", icon: "🔄", label: "Step Function" },
  CloudFormationStack: { color: "#1A5276", icon: "📦", label: "CloudFormation Stack" },
  Route53HostedZone: { color: "#8E44AD", icon: "🗺️", label: "Route 53 Hosted Zone" },
  EFSFileSystem: { color: "#27AE60", icon: "📁", label: "EFS File System" },
  ECRRepository: { color: "#E67E22", icon: "🐋", label: "ECR Repository" },
  ElastiCacheCluster: { color: "#1ABC9C", icon: "⚡", label: "ElastiCache Cluster" },
  EventBridgeRule: { color: "#E74C3C", icon: "📅", label: "EventBridge Rule" },
  KinesisStream: { color: "#2471A3", icon: "🌊", label: "Kinesis Stream" },
  CognitoUserPool: { color: "#A93226", icon: "👥", label: "Cognito User Pool" },
  SecretsManagerSecret: { color: "#D35400", icon: "🔐", label: "Secrets Manager Secret" },
  ACMCertificate: { color: "#F39C12", icon: "📜", label: "ACM Certificate" },
  KMSKey: { color: "#7D3C98", icon: "🗝️", label: "KMS Key" },
  WAFWebACL: { color: "#E74C3C", icon: "🛡️", label: "WAF Web ACL" },
  CodePipeline: { color: "#2E86C1", icon: "🔧", label: "CodePipeline" },
  CodeBuildProject: { color: "#1A5276", icon: "🏗️", label: "CodeBuild Project" },
  CodeCommitRepo: { color: "#1A5276", icon: "📝", label: "CodeCommit Repo" },
  AmplifyApp: { color: "#E67E22", icon: "📱", label: "Amplify App" },
};

export function getResourceTypeStyle(type: string): ResourceTypeStyle {
  return RESOURCE_TYPE_STYLES[type] ?? { color: "#95A5A6", icon: "❓", label: type };
}
