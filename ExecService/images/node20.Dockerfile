FROM node:20-alpine
RUN apk add --no-cache python3 make g++ git curl bash
RUN npm install -g tsx nodemon @vitejs/create-app create-next-app
RUN addgroup -S sandbox && adduser -S sandbox -G sandbox
RUN mkdir -p /workspace && chown sandbox:sandbox /workspace && chmod 755 /workspace
WORKDIR /workspace
USER sandbox
RUN npm install --prefix /tmp/cache react react-dom vite next express 2>/dev/null || true
