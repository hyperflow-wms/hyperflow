
FROM node:8.4.0

WORKDIR /usr/src/app

COPY package.json .

RUN npm install

COPY . .

ENV PORT=80

EXPOSE ${PORT}

CMD [ "npm", "start" ]
