
FROM node:10

WORKDIR /usr/src/app

#COPY package.json .

RUN yarn install https://github.com/hyperflow-wms/hyperflow/archive/master.tar.gz 

# COPY . .

#ENV PORT=80

#EXPOSE ${PORT}

#CMD [ "npm", "start" ]
