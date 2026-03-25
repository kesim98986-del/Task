# Node.js 20 + Chromium + all dependencies
FROM node:20-slim

# Install Chromium and all required system libraries
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
       chromium \
       fonts-liberation \
       fonts-noto-color-emoji \
       libasound2 \
       libatk-bridge2.0-0 \
       libatk1.0-0 \
       libcups2 \
       libdbus-1-3 \
       libdrm2 \
       libgbm1 \
       libgtk-3-0 \
       libnspr4 \
       libnss3 \
       libx11-xcb1 \
       libxcomposite1 \
       libxdamage1 \
       libxrandr2 \
       xdg-utils \
       ca-certificates \
       procps && \
    rm -rf /var/lib/apt/lists/*

# Tell Puppeteer to use system Chromium
ENV CHROMIUM_PATH=/usr/bin/chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Set working directory
WORKDIR /app

# Copy package files first
COPY package*.json ./

# Install Node dependencies
RUN npm install --omit=dev

# Copy all source files
COPY . .

# Create persistent data directory
RUN mkdir -p /data/user_data

# Environment defaults
ENV USER_DATA_DIR=/data/user_data
ENV HEADLESS=true
ENV NODE_ENV=production

# Start the bot
CMD ["node", "main.js"]
