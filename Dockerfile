FROM node:18

# Create app directory
WORKDIR /App

# Install app dependencies
# A wildcard is used to ensure both package.json AND package-lock.json are copied
# where available (npm@5+)
COPY package*.json ./
COPY yarn*.lock ./
RUN yarn install 

# If you are building your code for production
# RUN npm ci --only=production

# Bundle app source
COPY index.js ./

USER node
EXPOSE 4443
ENTRYPOINT [ "yarn", "start" ]

