FROM node:18-bullseye-slim

# Cài đặt wireguard-tools, sudo và các công cụ mạng cần thiết
# (Giúp VPS không cần cài đặt gì thêm, mọi thứ chạy trong container)
RUN apt-get update && \
    apt-get install -y wireguard-tools sudo iproute2 iptables && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Cài đặt dependencies
COPY package*.json ./
COPY prisma ./prisma/
RUN npm install

# Copy source code và build
COPY . .
RUN npm run build

# Expose port (Dù dùng network_mode: "host" thì vẫn khai báo để documentation rõ ràng)
EXPOSE 10004

# Chạy migration DB và start server
CMD npx prisma db push && npm run start:prod
