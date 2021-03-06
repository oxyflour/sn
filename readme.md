# Experimental Full-stack Development Tool

* next-like front pages serving (check `src/pages`)
* typesafe async functions and generators invokes (check `src/lambda`)
* automatically image building with `kaniko` and deploying in `kubernetes`

## cli

```bash
# serve tsx pages in `pages` folder and async functions/generators in `lambda` folder,
# with hot-module-reloading enabled
sn
```

```bash
# deploy current app to kubernetes
sn deploy
```

## internal cli

```bash
# will be executed to build `pages` with webpack and `lambda` with typescript in kaniko
sn build
```

```bash
# will be executed when serving in kubernetes in production mode
sn start
```

```bash
# will be executed internally for serving generators
sn pip <hash> <url>
```
