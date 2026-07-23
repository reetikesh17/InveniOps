# Dev-mode image only: runs the Vite dev server against a bind-mounted
# source tree for hot reload (see the frontend service in docker-compose.yml).
FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
EXPOSE 5173
CMD ["npm", "run", "dev"]
