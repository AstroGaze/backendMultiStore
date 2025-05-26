# 1. Base Image - Use an official Node.js image that includes tools for Playwright dependencies
# Choose a Node.js version that matches your development environment or project requirements
# Node 18 or 20 are good choices.
FROM mcr.microsoft.com/playwright/javascript:v1.44.0-jammy
# Note: The Playwright base image above (e.g., v1.44.0-jammy for Playwright 1.44)
# comes with browsers pre-installed and all necessary dependencies.
# This significantly simplifies things.
# Check https://playwright.dev/docs/docker and https://mcr.microsoft.com/en-us/product/playwright/javascript/about
# for the latest recommended base images corresponding to your Playwright version.
# If your Playwright version in package.json is different (e.g., 1.52.0), find a matching base image.
# For Playwright 1.52.0, an image like `mcr.microsoft.com/playwright/javascript:v1.52.0-jammy` might exist.
# If not, you might need to use a more generic Node image and install dependencies manually.
# Let's assume your Playwright version is compatible with a recent base image.
# For Playwright v1.52.0, a general Node image might be `node:18-slim` or `node:20-slim`
# and then you'd need to add Playwright's dependency installation steps.
#
# *** Using Playwright's official base image is STRONGLY recommended. ***
# If you are using Playwright 1.52.0, and `mcr.microsoft.com/playwright/javascript:v1.52.0-jammy` is not available,
# you can try a recent general Playwright image or stick with a slightly older one if your code is compatible.
# Let's proceed assuming a compatible Playwright base image like:
# FROM mcr.microsoft.com/playwright/javascript:v1.44.0-jammy
# (Adjust the version tag vX.Y.Z-jammy as per your Playwright version)

# Set the working directory in the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json (or yarn.lock)
COPY package*.json ./

# Install dependencies
# The Playwright base image often has Node and npm/yarn pre-installed.
RUN npm install --production --ignore-scripts
# The --ignore-scripts might prevent Playwright from trying to download browsers again if they are already in the base image.
# If the base image *doesn't* have browsers, you'd run `npx playwright install --with-deps chromium` here.
# However, the official Playwright images *should* have them.

# Copy the rest of your application code
COPY . .

# Expose the port your app runs on (this is for documentation, Render handles actual port mapping)
EXPOSE 3001
# Render will set the PORT environment variable, your app should listen on process.env.PORT

# Command to run your application
# This will use the "start" script from your package.json
CMD [ "npm", "start" ]