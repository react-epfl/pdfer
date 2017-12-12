FROM mhart/alpine-node:8.9.1

# add dependencies to alpine
RUN apk update
RUN apk add --no-cache git bash

# get latest unoconv script and hack it to use python3
# (it fixes an issue about unoconv listener failing first time with libreoffice)
# reference: https://github.com/dagwieers/unoconv/pull/327
ADD https://raw.githubusercontent.com/dagwieers/unoconv/master/unoconv /usr/bin/unoconv
RUN chmod +xr /usr/bin/unoconv
RUN sed -i 's/env python$/env python3/' /usr/bin/unoconv

RUN mkdir -p /usr/src/app
WORKDIR /usr/src/app

# add version
ADD VERSION .

# install app dependencies
COPY package.json /usr/src/app/
RUN npm install

# bundle app source
COPY . /usr/src/app

EXPOSE 8084

CMD ["npm", "start"]
