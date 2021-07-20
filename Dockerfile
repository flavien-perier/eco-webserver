FROM node:lts-alpine as builder

LABEL maintainer="Flavien PERIER <perier@flavien.io>"
LABEL version="1.0.9"
LABEL description="eco-webserver"

RUN apk add --no-cache build-base g++ python libpng-dev jpeg-dev giflib-dev pango-dev cairo-dev git ca-certificates wget

WORKDIR /opt/eco-webserver
COPY . .

RUN wget -q -O /etc/apk/keys/sgerrand.rsa.pub https://alpine-pkgs.sgerrand.com/sgerrand.rsa.pub && \
    wget https://github.com/sgerrand/alpine-pkg-glibc/releases/download/2.29-r0/glibc-2.29-r0.apk && \
    apk add glibc-2.29-r0.apk && \
    rm glibc-2.29-r0.apk && \
    npm install --production && \
    chmod -R 750 /opt/eco-webserver

FROM node:lts-alpine

ARG DOCKER_UID=500
ARG DOCKER_GID=500

ENV ECO_CACHE_CYCLE=1800

WORKDIR /opt/eco-webserver
COPY --from=builder /opt/eco-webserver .

RUN apk add --no-cache libpng-dev jpeg-dev giflib-dev pango-dev cairo-dev && \
    addgroup -g $DOCKER_GID eco-webserver && \
    adduser -G eco-webserver -D -H -h /opt/eco-webserver -u $DOCKER_UID eco-webserver && \
    mkdir /dist && \
    mkdir /cache && \
    chown -R eco-webserver:eco-webserver /opt/eco-webserver && \
    chown eco-webserver:eco-webserver /dist && \
    chown eco-webserver:eco-webserver /cache

USER eco-webserver
VOLUME /dist
VOLUME /cache
EXPOSE 8080

CMD ./cli.js
