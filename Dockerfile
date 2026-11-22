FROM node:20-alpine

#ENV PATH $PATH:/node_modules/.bin

# Docker client, for executor functions that spawn worker containers
RUN apk add --no-cache docker-cli

# Version that `hflow --version` reports: a semver string such as 1.11.2,
# or 1.11.2-3-gabc1234 between releases, followed by -dirty when the tree
# had uncommitted changes to tracked files. `make image` passes the nearest
# version tag, as `git describe` reports it, without its leading "v" (see
# the Makefile). When it is not set, package.json keeps the repository's
# 0.0.0-dev. scripts/check-version.sh fails the build, before `npm version`
# runs, for anything but a strict semver 2.0.0 version without build
# metadata: npm keywords such as "patch", options such as "--help", leading
# zeros, "+build" and short forms such as 1.12 are all rejected.
ARG VERSION

COPY . /hyperflow
WORKDIR /hyperflow
RUN if [ -n "$VERSION" ]; then sh scripts/check-version.sh "$VERSION" && npm version --no-git-tag-version --allow-same-version "$VERSION"; fi
RUN npm install
RUN npm install -g .
