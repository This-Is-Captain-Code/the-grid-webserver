# Use the official Node.js image as the base image
FROM node:18-alpine

# Set the working directory inside the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the entire app to the working directory
COPY . .

# Expose the port your app runs on
EXPOSE 8080

# Start the application
CMD ["node", "server.js"]
