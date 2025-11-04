FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm i --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
COPY sql ./sql
CMD ["npm","run","dev"]
