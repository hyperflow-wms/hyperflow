FROM node:10-alpine

RUN npm install https://github.com/hyperflow-wms/hyperflow/archive/master.tar.gz 
ENV PATH $PATH:/node_modules/.bin
