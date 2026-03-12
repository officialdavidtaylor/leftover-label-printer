FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json tsconfig.json tsconfig.backend.json /app/
RUN npm ci --omit=dev

COPY backend /app/backend

CMD ["node", "--experimental-strip-types", "backend/src/server.ts"]
