FROM node:22-bullseye

# Set npm registry
RUN npm config set registry https://registry.npmjs.org/

# Install job-executor globally
RUN npm install -g --loglevel verbose @marsel888/job-executor@1.4.8

# Update package lists and install required dependencies
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    curl \
    dumb-init \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Install speedtest-cli via pip
RUN pip3 install speedtest-cli

# Verify installation
RUN which speedtest-cli || echo "speedtest-cli not in PATH"

# Create a wrapper script for speedtest
RUN echo '#!/bin/bash' > /usr/local/bin/speedtest \
    && echo 'exec speedtest-cli "$@"' >> /usr/local/bin/speedtest \
    && chmod +x /usr/local/bin/speedtest

# Download and configure dumb-init manually
RUN wget -O /usr/local/bin/dumb-init https://github.com/Yelp/dumb-init/releases/download/v1.2.5/dumb-init_1.2.5_x86_64
RUN chmod +x /usr/local/bin/dumb-init

# Set entrypoint
ENTRYPOINT ["/usr/local/bin/dumb-init", "--"]
