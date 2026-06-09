# 1. Tell Terraform we are using AWS
provider "aws" {
  region = "us-east-1" # Change this if your server is in another region
}

# 2. Automate the Security Group (The Firewall)
resource "aws_security_group" "launch-wizard-4" {
  name        = "launch-wizard-4"
  description = "Security group for SRE IMS project"

  ingress {
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # HTTP (Nginx Shield)
  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }


  # Grafana Dashboard
  ingress {
    from_port   = 3000
    to_port     = 3000
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # React Frontend (Direct Docker Port)
  ingress {
    from_port   = 5137
    to_port     = 5137
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # FastAPI Backend (Direct Docker Port)
  ingress {
    from_port   = 8000
    to_port     = 8000
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # Prometheus Metrics
  ingress {
    from_port   = 9090
    to_port     = 9090
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # RabbitMQ Management UI
  ingress {
    from_port   = 15672
    to_port     = 15672
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # Allow Server to reach the internet (to pull Docker images, etc.)
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# 3. Automate the EC2 Server
resource "aws_instance" "ims-production-server" {
  ami           = "ami-091138d0f0d41ff90" # Ubuntu 24.04 in us-east-1 (verify this matches yours)
  instance_type = "t3.small"
  key_name      = "ims-prod-key"          # MUST match the exact name of your existing .pem key in AWS

  # Attach the security group we created above
  vpc_security_group_ids = [aws_security_group.launch-wizard-4.id]

  # Automate the EBS Volume Expansion (no more ENOSPC errors!)
  root_block_device {
    volume_size = 16
    volume_type = "gp3"
  }

  tags = {
    Name = "ims-automated-production"
  }
}

# 4. Print the new IP address when finished
output "server_public_ip" {
  value = aws_instance.ims-production-server.public_ip
}