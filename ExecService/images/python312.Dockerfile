FROM python:3.12-alpine
RUN apk add --no-cache gcc musl-dev libffi-dev git curl bash
RUN pip install --no-cache-dir flask django fastapi uvicorn requests numpy pandas
RUN addgroup -S sandbox && adduser -S sandbox -G sandbox
RUN mkdir -p /workspace && chown sandbox:sandbox /workspace && chmod 755 /workspace
RUN mkdir -p /home/sandbox/.local && chown -R sandbox:sandbox /home/sandbox
WORKDIR /workspace
USER sandbox
ENV PATH="/home/sandbox/.local/bin:$PATH"
ENV PYTHONUSERBASE=/home/sandbox/.local
