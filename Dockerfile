FROM node:lts-alpine as builder

WORKDIR /opt/eco-webserver

COPY --chown=root:root . .

RUN apk add --no-cache build-base g++ python libpng-dev jpeg-dev giflib-dev pango-dev cairo-dev git ca-certificates wget && \
    wget -q -O /etc/apk/keys/sgerrand.rsa.pub https://alpine-pkgs.sgerrand.com/sgerrand.rsa.pub && \
    wget https://github.com/sgerrand/alpine-pkg-glibc/releases/download/2.29-r0/glibc-2.29-r0.apk && \
    apk add glibc-2.29-r0.apk && \
    rm glibc-2.29-r0.apk && \
    npm install --production && \
    chmod -R 750 /opt/eco-webserver

FROM node:lts-alpine

LABEL maintainer="Flavien PERIER <perier@flavien.io>" \
      version="1.0.12" \
      description="eco-webserver"

ARG DOCKER_UID="500" \
    DOCKER_GID="500"

ENV ECO_CACHE_CYCLE="1800"

WORKDIR /opt/eco-webserver
VOLUME ["/dist", "/cache"]

RUN apk add --no-cache libpng-dev jpeg-dev giflib-dev pango-dev cairo-dev && \
    addgroup -g $DOCKER_GID eco-webserver && \
    adduser -G eco-webserver -D -H -h /opt/eco-webserver -u $DOCKER_UID eco-webserver

COPY --chown=eco-webserver:eco-webserver --from=builder /opt/eco-webserver .

USER eco-webserver

EXPOSE 8080

CMD ./cli.js
