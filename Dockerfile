# ใช้กับโฮสต์ที่รองรับ Docker (Koyeb, Fly.io, Railway ฯลฯ)
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
ENV NODE_ENV=production TRUST_PROXY=1
EXPOSE 3000
CMD ["node", "server.js"]
