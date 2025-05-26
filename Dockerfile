# 1. Base Image - Use an official Playwright image for your Playwright version
# This image includes browsers and their OS dependencies.
# We will use the -jammy (Ubuntu 22.04 LTS) tag for Playwright v1.52.0
FROM mcr.microsoft.com/playwright:v1.52.0-jammy

# Set the working directory in the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json (or yarn.lock)
# This is done before copying the rest of the code to leverage Docker layer caching.
# If these files don't change, Docker can reuse the 'npm install' layer.
COPY package*.json ./

# Install application dependencies, including the Playwright package itself.
# The base image has Node.js and npm/yarn.
# Use --production to skip devDependencies.
# We do NOT use --ignore-scripts here because we want Playwright's own install
# scripts to run if they need to verify/link browsers, though the base image
# should have the browsers ready.
RUN npm install --production

# Copy the rest of your application code from your 'backend' directory
# into the /usr/src/app directory in the container.
COPY . .

# Expose the port your app runs on (for documentation; Render maps the actual port)
# Your app should listen on process.env.PORT, which Render will provide.
EXPOSE 3001

# Command to run your application
# This will execute "npm start" as defined in your package.json
CMD [ "npm", "start" ]