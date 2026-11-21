FROM node:20-alpine

#ENV PATH $PATH:/node_modules/.bin

# Docker client, for executor functions that spawn worker containers
RUN apk add --no-cache docker-cli

# Version that `hflow --version` reports: a semver string such as 1.11.2,
# or 1.11.2-3-gabc1234 between releases. `make image` passes the
# `git describe --tags` output without its leading "v". When it is not set, package.json keeps the
# repository's 0.0.0-dev. An invalid version fails the build.
ARG VERSION

COPY . /hyperflow
WORKDIR /hyperflow
RUN if [ -n "$VERSION" ]; then npm version --no-git-tag-version --allow-same-version "$VERSION"; fi
RUN npm install
RUN npm install -g .
