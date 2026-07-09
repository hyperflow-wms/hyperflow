import {
  CreateVpcCommand,
  CreateSubnetCommand,
  DescribeSecurityGroupsCommand,
  CreateInternetGatewayCommand,
  AttachInternetGatewayCommand,
  CreateRouteTableCommand,
  CreateRouteCommand,
  AssociateRouteTableCommand,
  ModifyVpcAttributeCommand,
  AuthorizeSecurityGroupIngressCommand,
} from "@aws-sdk/client-ec2";

export async function createVPCAndSubnets(ec2Client, dryRun = false) {
  if (dryRun) {
    console.log(`📝 [DRY RUN] Would create VPC and subnets:`);
    console.log(`   - VPC CIDR: 10.0.0.0/16`);
    console.log(`   - Subnet 1: 10.0.1.0/24 (us-east-1a)`);
    console.log(`   - Subnet 2: 10.0.2.0/24 (us-east-1b)`);
    console.log(`   - Internet Gateway with route tables`);
    console.log(`   - Security group ingress rule for EFS (port 2049)`);

    // Return mock VPC data
    return {
      securityGroup: {
        GroupId: "sg-mock123456789",
        GroupName: "default",
        VpcId: "vpc-mock123456789",
      },
      subnets: [
        {
          SubnetId: "subnet-mock1234567890abcdef1",
          VpcId: "vpc-mock123456789",
          CidrBlock: "10.0.1.0/24",
          AvailabilityZone: "us-east-1a",
        },
        {
          SubnetId: "subnet-mock1234567890abcdef2",
          VpcId: "vpc-mock123456789",
          CidrBlock: "10.0.2.0/24",
          AvailabilityZone: "us-east-1b",
        },
      ],
    };
  }

  try {
    const createVpcParams = {
      CidrBlock: "10.0.0.0/16",
      TagSpecifications: [
        {
          ResourceType: "vpc",
          Tags: [{ Key: "Name", Value: "HyperflowFargateVPC" }],
        },
      ],
    };

    const vpcData = await ec2Client.send(new CreateVpcCommand(createVpcParams));
    const vpcId = vpcData.Vpc.VpcId;
    console.log("VPC created successfully:", vpcData.Vpc);

    const dnsParams = {
      VpcId: vpcId,
      EnableDnsHostnames: {
        Value: true,
      },
    };
    await ec2Client.send(new ModifyVpcAttributeCommand(dnsParams));
    console.log("DNS hostnames enabled for VPC:", vpcId);

    const createSubnetParams1 = {
      VpcId: vpcId,
      CidrBlock: "10.0.1.0/24",
      AvailabilityZone: "us-east-1a",
      TagSpecifications: [
        {
          ResourceType: "subnet",
          Tags: [{ Key: "Name", Value: "HyperflowSubnet1" }],
        },
      ],
    };

    const subnetData1 = await ec2Client.send(
      new CreateSubnetCommand(createSubnetParams1)
    );
    console.log("Subnet 1 created successfully:", subnetData1.Subnet);

    const createSubnetParams2 = {
      VpcId: vpcId,
      CidrBlock: "10.0.2.0/24",
      AvailabilityZone: "us-east-1b",
      TagSpecifications: [
        {
          ResourceType: "subnet",
          Tags: [{ Key: "Name", Value: "HyperflowSubnet2" }],
        },
      ],
    };

    const subnetData2 = await ec2Client.send(
      new CreateSubnetCommand(createSubnetParams2)
    );

    console.log("Subnet 2 created successfully:", subnetData2.Subnet);
    const securityGroup = await getDefaultSecurityGroup(ec2Client, vpcId);

    const ingressRuleParams = {
      GroupId: securityGroup.GroupId,
      IpPermissions: [
        {
          IpProtocol: "tcp",
          FromPort: 2049,
          ToPort: 2049,
          IpRanges: [{ CidrIp: "0.0.0.0/0" }],
        },
      ],
    };

    const data = await ec2Client.send(
      new AuthorizeSecurityGroupIngressCommand(ingressRuleParams)
    );
    console.log("Security Group Ingress Rule added successfully", data);

    const igwData = await ec2Client.send(new CreateInternetGatewayCommand({}));
    const igwId = igwData.InternetGateway.InternetGatewayId;
    console.log("Internet Gateway created successfully:", igwId);

    const attachIgwParams = {
      InternetGatewayId: igwId,
      VpcId: vpcId,
    };
    await ec2Client.send(new AttachInternetGatewayCommand(attachIgwParams));
    console.log("Internet Gateway attached successfully to VPC:", vpcId);

    const routeTableParams = {
      VpcId: vpcId,
    };
    const routeTableData = await ec2Client.send(
      new CreateRouteTableCommand(routeTableParams)
    );
    const routeTableId = routeTableData.RouteTable.RouteTableId;
    console.log("Route Table created successfully:", routeTableId);

    const routeParams = {
      RouteTableId: routeTableId,
      DestinationCidrBlock: "0.0.0.0/0",
      GatewayId: igwId,
    };
    await ec2Client.send(new CreateRouteCommand(routeParams));
    console.log("Route to Internet Gateway created successfully.");

    const associateRouteTableParams1 = {
      SubnetId: subnetData1.Subnet.SubnetId,
      RouteTableId: routeTableId,
    };
    await ec2Client.send(
      new AssociateRouteTableCommand(associateRouteTableParams1)
    );
    console.log(
      "Route Table associated successfully with Subnet 1:",
      subnetData1.Subnet.SubnetId
    );

    const associateRouteTableParams2 = {
      SubnetId: subnetData2.Subnet.SubnetId,
      RouteTableId: routeTableId,
    };
    await ec2Client.send(
      new AssociateRouteTableCommand(associateRouteTableParams2)
    );
    console.log(
      "Route Table associated successfully with Subnet 2:",
      subnetData2.Subnet.SubnetId
    );

    return {
      securityGroup,
      subnets: [subnetData1.Subnet, subnetData2.Subnet],
    };
  } catch (err) {
    console.error("Error creating VPC or subnets:", err);
    return [];
  }
}

async function getDefaultSecurityGroup(ec2Client, vpcId) {
  try {
    const params = {
      Filters: [
        {
          Name: "vpc-id",
          Values: [vpcId],
        },
        {
          Name: "group-name",
          Values: ["default"],
        },
      ],
    };

    const data = await ec2Client.send(
      new DescribeSecurityGroupsCommand(params)
    );

    if (data.SecurityGroups && data.SecurityGroups.length > 0) {
      const defaultSecurityGroup = data.SecurityGroups[0];
      console.log("Default security group for VPC:", defaultSecurityGroup);
      return defaultSecurityGroup;
    } else {
      console.log("No default security group found for VPC:", vpcId);
    }
  } catch (err) {
    console.error("Error retrieving the default security group:", err);
  }
}
