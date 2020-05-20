FROM node:12-alpine

#ENV PATH $PATH:/node_modules/.bin

COPY . /hyperflow
RUN npm install -g /hyperflow 
