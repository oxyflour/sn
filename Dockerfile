FROM pc10.yff.me/node:14
WORKDIR /app
RUN npm config set registry https://registry.npm.taobao.org/
COPY package*.json ./
RUN npm ci
COPY . ./
RUN npm run build
RUN node dist/cli.js build
CMD ["node", "dist/cli.js", "start"]
