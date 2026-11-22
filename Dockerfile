# Draft (step 1a): not built yet. Build the web app, then run the API server, which also serves web/dist.
FROM node:26-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY web/package.json web/
COPY server/package.json server/
RUN npm ci
COPY web web
# The diagram data (diagram-studio/1 files, rule 17) is bundled into the web build by Vite: web/src/diagrams/loadDiagram.js reads ../../../diagrams.
COPY diagrams diagrams
RUN npm run build -w web

FROM node:26-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=7833 MODE=mock
COPY package.json package-lock.json ./
COPY web/package.json web/
COPY server/package.json server/
RUN npm ci --omit=dev -w server && npm cache clean --force
COPY server/src server/src
COPY docs/talk-track.md docs/talk-track.md
COPY --from=build /app/web/dist web/dist
USER node
EXPOSE 7833
# Inside the container the server must listen on all interfaces, so PGC_BIND is set here on purpose.
# The compose file publishes the port on 127.0.0.1 only; do not publish it more widely.
ENV PGC_BIND=0.0.0.0
CMD ["node", "server/src/index.js"]
