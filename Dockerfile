FROM pc10.yff.me/node:14
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
RUN node dist/cli.js build
CMD ["node", "dist/cli.js", "start"]
