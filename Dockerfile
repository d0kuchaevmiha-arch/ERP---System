FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1 DATABASE_URL=postgresql://postgres:postgres@localhost:5432/app_db
RUN npm run build
FROM node:22-alpine
WORKDIR /app
COPY --from=build /app ./
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
EXPOSE 3000
CMD ["sh","-c","npx drizzle-kit push && npx tsx scripts/seed.ts && npm run start"]
