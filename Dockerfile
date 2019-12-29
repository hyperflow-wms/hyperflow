FROM node:10-alpine

ENV PATH $PATH:/node_modules/.bin

COPY . /home/node
RUN cd /home/node && npm install
