FROM node:latest
WORKDIR /usrs/src/server

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 9601

CMD [ "node", "app.js" ]