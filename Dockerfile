FROM node:20-alpine
WORKDIR /app
RUN apk add --no-cache curl
COPY package.json package-lock.json* /app/
RUN npm ci --omit=dev
COPY src /app/src
COPY public /app/public
COPY .env.example /app/.env.example
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -sf http://localhost:3000/health || exit 1
CMD ["node", "src/server.js"]