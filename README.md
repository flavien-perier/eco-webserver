# eco-webserver

## ToDO

- [X] GZIP implementation
- [ ] CSS minify at the fly
- [X] Isomorphic application
- [X] Cache files

## Configuration exemple

Create `ecoconf.json` at the base path of the project :

```json
{
    "port": 8080,
    "cacheCycle": 900,
    "distDir": "dist",
    "header": {
        "Server": "eco-webserver"
    },
    "contentType": {}
}
```

## Architecture
