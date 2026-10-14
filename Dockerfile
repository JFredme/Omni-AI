# OMNI AI. Build: docker build -t omni-ai .   (docker-compose.yml wires it to Postgres.)
FROM node:22-alpine AS base
WORKDIR /app

FROM base AS build
COPY package.json package-lock.json ./
COPY scripts ./scripts
COPY prisma ./prisma
COPY prisma7.config.ts ./
# postinstall generates the Prisma client and copies the code editor's files into public/monaco.
RUN npm ci
COPY . .
# Building needs a connection string to exist, not a database to answer; the real one is supplied at run time.
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build"
RUN npm run build

FROM base AS run
ENV NODE_ENV=production
COPY --from=build /app ./
# The container listens on every interface; docker-compose publishes it on your machine only.
EXPOSE 3000
# Apply any new migrations (they only add), then start.
CMD ["sh", "-c", "npx prisma migrate deploy && npx next start -H 0.0.0.0 -p 3000"]
