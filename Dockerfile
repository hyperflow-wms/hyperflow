FROM node:12-alpine

#ENV PATH $PATH:/node_modules/.bin

COPY . /hyperflow
RUN npm install -g /hyperflow 
RUN npm install -g https://github.com/hyperflow-wms/hflow-tools/archive/master.tar.gz
