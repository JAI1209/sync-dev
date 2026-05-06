FROM node:20-alpine
RUN apk add --no-cache python3 make g++ git curl bash
RUN npm install -g tsx nodemon @vitejs/create-app create-next-app create-vite create-react-app
RUN addgroup -S sandbox && adduser -S sandbox -G sandbox
RUN mkdir -p /workspace && chown sandbox:sandbox /workspace && chmod 755 /workspace
RUN npm install --prefix /home/node/cache react react-dom vite next express typescript 2>/dev/null || true
ENV NPM_CONFIG_CACHE=/home/node/cache
WORKDIR /workspace
USER sandbox
