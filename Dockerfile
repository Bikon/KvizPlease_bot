# Dockerfile
FROM node:20-slim

# Устанавливаем Chromium и системные зависимости для рендеринга
RUN apt-get update && apt-get install -y \
  chromium ca-certificates fonts-liberation \
  libasound2 libatk-bridge2.0-0 libatk1.0-0 libatspi2.0-0 \
  libc6 libcairo2 libcups2 libdbus-1-3 libdrm2 libexpat1 \
  libgbm1 libglib2.0-0 libgtk-3-0 libnspr4 libnss3 \
  libpango-1.0-0 libx11-6 libx11-xcb1 libxcb1 libxcomposite1 \
  libxdamage1 libxext6 libxfixes3 libxrandr2 libxrender1 \
  libxshmfence1 xdg-utils wget --no-install-recommends \
  && rm -rf /var/lib/apt/lists/*

# Говорим Puppeteer, где исполняемый файл браузера
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund

COPY tsconfig.json ./
COPY src ./src
COPY sql ./sql

# сборка и запуск через npm scripts
CMD ["sh", "-c", "npm run build && npm start"]
