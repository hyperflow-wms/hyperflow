FROM node:12-alpine

ENV NODE_PATH=/usr/local/lib/node_modules

COPY . /hyperflow

RUN mkdir -p /tmp/kubectl && cd /tmp/kubectl && apk add curl && \
    curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl" && \
    install -o root -g root -m 0755 kubectl /usr/local/bin/kubectl

RUN npm install -g @hyperflow/standalone-autoscaler-plugin @hyperflow/autoscaler-plugin /hyperflow
