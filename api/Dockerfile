FROM node:20-alpine

WORKDIR /app

# Copy package files first (Docker layer caching optimization)
COPY package*.json ./

# Install production dependencies only
RUN npm install --omit=dev

# Copy source code
COPY src/ ./src/

# Expose port
EXPOSE 3000

# Start the server
CMD ["node", "src/index.js"]
