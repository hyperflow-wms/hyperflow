FROM node:20-alpine

#ENV PATH $PATH:/node_modules/.bin

# Docker client, for executor functions that spawn worker containers
RUN apk add --no-cache docker-cli

COPY . /hyperflow
WORKDIR /hyperflow
RUN npm install
RUN npm install -g .
