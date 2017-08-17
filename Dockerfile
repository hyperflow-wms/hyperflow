
FROM node:8.4.0

WORKDIR /usr/src/app

COPY package.json .

RUN npm install

COPY . .

ENV PORT=80
ENV REDIS_HOST=redis

EXPOSE ${PORT}

CMD [ "npm", "start" ]
