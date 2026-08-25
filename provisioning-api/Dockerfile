FROM node:22-bookworm-slim

RUN apt-get update && \
    apt-get install -y \
        wireguard-tools \
        sudo \
        iproute2 \
        iptables \
        openssl \
        build-essential \
        python3 && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/

RUN npm ci
RUN npx prisma generate

COPY . .

RUN npm run build

EXPOSE 10004

CMD ["sh", "-c", "npx prisma db push && npx prisma db seed && npm run start:prod"]