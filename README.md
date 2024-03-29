![license](https://badgen.net/github/license/flavien-perier/eco-webserver)
[![docker pulls](https://badgen.net/docker/pulls/flavienperier/eco-webserver)](https://hub.docker.com/r/flavienperier/eco-webserver)
[![npm version](https://badgen.net/npm/v/eco-webserver)](https://www.npmjs.com/package/eco-webserver)
[![ci status](https://badgen.net/github/checks/flavien-perier/eco-webserver)](https://github.com/flavien-perier/eco-webserver)

# eco-webserver

The objective of eco-webserver is to propose a nodejs server able to reduce the network footprint of a static site or a single page application (SPA).

To do so, the server uses different strategies depending on the types of files it hosts.

## Features

- [X] Cache files
- [X] Reverse proxy
- [X] Isomorphic application
- [X] GZIP implementation
- [X] Include Etag
- [X] Include html minifiers
- [X] Include css minifiers
- [X] Include json minifiers
- [X] Include js minifiers with [terser](https://www.npmjs.com/package/terser)
- [ ] Optimize images and convert them to webp
- [ ] Optimize svg path
- [ ] Optimize fonts and convert them to woff2

## Usage

### Installation

```sh
npm install -g eco-webserver
```

### Command line

```sh
cd project
eco-webserver
```

By default, the `eco-webserver` command does not take any parameters. If no configuration file is present in the current directory, the application will automatically create one.

### Configuration

Create `ecoconf.js` at the base path of the project :

```js
module.exports = {
    port: 8080,
    cacheCycle: 1800,
    distDir: "dist",
    cacheDir: "cache",
    logDir: "/tmp/eco-webserver.log",
    enableIsomorphic: true,
    header: {
        "Server": "eco-webserver",
        "Cache-Control": "max-age=86400",
        "X-XSS-Protection": "1;mode=block",
        "X-Frame-Options": "DENY",
    },
    contentType: {
        "mp4": "video/mpeg",
    },
    proxy: {
        "/articles": "https://articles.flavien.io/"
    },
}
```

- **port**: The default port of the application.
- **cacheCycle**: Duration in seconds between two cache check cycles.
- **distDir**: Location of website files to be exhibited.
- **cacheDir**: Location of the working cache.
- **logDir**: Location of log file.
- **enableIsomorphic**: Calculates a rendering of the JavaScript scripts before sending the page to the client.
- **header**: Html headers of the different queries.
- **contentType**: Allows you to add Content-Types if those supported by default by the application are not enough.
- **proxy**: Allows you to associate a remote resource with a local URL in order to cache it.

For PaaS or Docker platform users, it is possible to inject configuration through environment variables :

- `ECO_PORT`: The default port of the application.
- `ECO_CACHE_CYCLE`: Duration in seconds between two cache check cycles.
- `ECO_DIST_DIR`: Location of website files to be exhibited.
- `ECO_CACHE_DIR`: Location of the working cache.
- `ECO_LOG_DIR`: Location of log file.

### With Docker

#### Ports

- 8080: HTTP

#### Volumes

- /dist
- /cache

#### Docker-compose example

```yaml
dns:
  image: flavienperier/eco-webserver
  container_name: eco-webserver
  restart: always
  volumes:
    - ./dist:/dist
    - ./cache:/cache
  ports:
    - 8080:8080
  environment:
    ECO_CACHE_CYCLE: 1800
```

### File organisation

If a client queries an unknown URL, the server will automatically redirect the request to the `index.html` file. If the server has a `404.html` file, the server will redirect its requests to this file.

## How the cache works ?

Each time a user requests a resource, it is cached. If the resource is requested again, its TTL will be incremented by 1 to a maximum of 10.

At each cache cycle (every 15 minutes in the default configuration), all TTL values are decremented by 1 and those falling to 0 are deleted from the cache.

Minification operations on resources are kept in a disk cache. The objective here is not to redo a minification operation that would have already been done in the past. Consequently, the cache associates the sha256 sum of a resource with its result after processing.
