FROM python:3.12-alpine
RUN addgroup -S sandbox && adduser -S sandbox -G sandbox
RUN mkdir -p /workspace && chown sandbox:sandbox /workspace && chmod 755 /workspace
WORKDIR /workspace
USER sandbox
