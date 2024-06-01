FROM node:lts-alpine as builder

WORKDIR /opt/eco-webserver

RUN apk add --no-cache build-base g++ python3 libpng-dev jpeg-dev giflib-dev pango-dev cairo-dev git ca-certificates wget && \
    wget -q -O /etc/apk/keys/sgerrand.rsa.pub https://alpine-pkgs.sgerrand.com/sgerrand.rsa.pub && \
    wget https://github.com/sgerrand/alpine-pkg-glibc/releases/download/2.29-r0/glibc-2.29-r0.apk && \
    apk add glibc-2.29-r0.apk && \
    rm glibc-2.29-r0.apk

COPY --chown=root:root --chmod=750 . .

RUN npm install --production

FROM node:lts-alpine

LABEL org.opencontainers.image.title="eco-webserver" \
      org.opencontainers.image.description="eco webserver" \
      org.opencontainers.image.version="1.0.13" \
      org.opencontainers.image.vendor="flavien.io" \
      org.opencontainers.image.maintainer="Flavien PERIER <perier@flavien.io>" \
      org.opencontainers.image.url="https://github.com/flavien-perier/eco-webserver" \
      org.opencontainers.image.source="https://github.com/flavien-perier/eco-webserver" \
      org.opencontainers.image.licenses="MIT"

ARG DOCKER_UID="1000" \
    DOCKER_GID="1000"

ENV ECO_CACHE_CYCLE="1800"

WORKDIR /opt/eco-webserver
VOLUME ["/dist", "/cache"]

RUN apk add --no-cache libpng-dev jpeg-dev giflib-dev pango-dev cairo-dev && \
    addgroup -g $DOCKER_GID eco-webserver && \
    adduser -G eco-webserver -D -H -h /opt/eco-webserver -u $DOCKER_UID eco-webserver

USER eco-webserver

EXPOSE 8080

COPY --chown=eco-webserver:eco-webserver --chmod=750 --from=builder /opt/eco-webserver .

CMD ./cli.js
