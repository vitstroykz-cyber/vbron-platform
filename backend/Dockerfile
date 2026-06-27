FROM node:20-alpine

WORKDIR /app

# Сначала только манифесты — для кэширования слоя с node_modules
COPY package*.json ./
RUN npm install --omit=dev

# Потом код приложения
COPY src ./src

# Порт, на который слушает приложение
EXPOSE 3000

# Запуск
CMD ["node", "src/index.js"]
