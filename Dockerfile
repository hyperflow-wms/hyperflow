FROM node:20-alpine

#ENV PATH $PATH:/node_modules/.bin

COPY . /hyperflow
WORKDIR /hyperflow
RUN npm install
RUN npm install -g .
