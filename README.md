# eco-webserver

## ToDO

- [X] Cache files
- [X] Isomorphic application
- [X] GZIP implementation
- [ ] CSS minify on the fly

## Configuration exemple

Create `ecoconf.json` at the base path of the project :

```json
{
    "port": 8080,
    "cacheCycle": 900,
    "distDir": "dist",
    "header": {
        "Server": "eco-webserver",
        "Cache-Control": "max-age=86400",
        "X-XSS-Protection": "1;mode=block",
        "X-Frame-Options": "DENY",
        "Content-Security-Policy": "default-src 'self'"
    },
    "contentType": {}
}
```

## Architecture
