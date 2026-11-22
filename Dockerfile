FROM node:20-alpine

#ENV PATH $PATH:/node_modules/.bin

# Docker client, for executor functions that spawn worker containers
RUN apk add --no-cache docker-cli

COPY . /hyperflow
WORKDIR /hyperflow
# make passes the image tag without its "v". npm writes it into package.json;
# a value npm rejects leaves 0.0.0-dev and prints a warning.
ARG VERSION
RUN if [ -n "$VERSION" ]; then npm version --no-git-tag-version --allow-same-version "$VERSION" || echo "warning: VERSION=$VERSION is not a valid version, keeping 0.0.0-dev"; fi
RUN npm install
RUN npm install -g .
