FROM node:22-bullseye

# Set npm registry
RUN npm config set registry https://registry.npmjs.org/

# Install job-executor globally
RUN npm install -g --loglevel verbose @marsel888/job-executor@1.4.8

# Update package lists and install required dependencies
RUN apt-get update && apt-get install -y \
    bash \
    coreutils \
    pciutils \
    build-essential \
    git \
    openssl \
    libssl-dev \
    libpcre3 \
    libpcre3-dev \
    zlib1g \
    zlib1g-dev \
    curl \
    p7zip-full \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Download and install pre-built Hashcat binaries
RUN curl -LO https://hashcat.net/files/hashcat-2.00.7z \
    && 7z x hashcat-2.00.7z -o/opt/ \
    && mv /opt/hashcat-2.00 /opt/hashcat \
    && chmod +x /opt/hashcat/hashcat-cli64.bin \
    && ln -s /opt/hashcat/hashcat-cli64.bin /usr/bin/hashcat \
    && chmod 755 /usr/bin/hashcat \
    && rm hashcat-2.00.7z

# Verify installation
RUN echo $PATH
RUN which hashcat || echo "hashcat not in PATH"

# Create a wrapper script for hashcat
RUN echo '#!/bin/bash' > /usr/local/bin/hashcat \
    && echo 'exec /opt/hashcat/hashcat-cli64.bin "$@"' >> /usr/local/bin/hashcat \
    && chmod +x /usr/local/bin/hashcat

# Set up environment
ENV PATH="/opt/hashcat:${PATH}"

RUN wget -O /usr/local/bin/dumb-init https://github.com/Yelp/dumb-init/releases/download/v1.2.5/dumb-init_1.2.5_x86_64
RUN chmod +x /usr/local/bin/dumb-init
ENTRYPOINT ["/usr/local/bin/dumb-init", "--"]