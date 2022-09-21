#!/usr/bin/env node

import fs from 'mz/fs'
import path from 'path'
import http from 'http'
import http2 from 'http2'
import koa from 'koa'
import mkdirp from 'mkdirp'
import program from 'commander'
import parser from 'koa-bodyparser'
import connect from 'koa-connect'
import serve from 'koa-static'
import route from '@koa/router'
import multer from '@koa/multer'
import { exec } from 'mz/child_process'
import { Server } from 'socket.io'

import react from '@vitejs/plugin-react'
import * as vite from 'vite'

import vitePlugin from './utils/vite'
import Emitter from './utils/emitter'
import { pip, rpc } from './wrapper/koa'
import { getHotMod, getMiddlewares, getModules } from './utils/module'
import { cluster, kaniko } from './utils/kube'

const cwd = process.cwd(),
    { name, version } = require(path.join(__dirname, '..', 'package.json'))
program.version(version).name(name)
require('ts-node/register')

function runAsyncOrExit(fn: (...args: any[]) => Promise<void>) {
    return (...args: any[]) => fn(...args)
        .catch(err => {
            console.error(err)
            process.exit(1)
        })
}

const options = {
    pages: path.join(cwd, 'src', 'pages'),
    lambda: path.join(cwd, 'src', 'lambda'),
    wrapper: '',
    include: { } as { [key: string]: string },
    middlewares: [ ] as string[],
    port: '8080',
    emitter: '',
    http2: undefined as undefined | {
        key: string | Buffer
        cert: string | Buffer
    },
    koa: {
        middlewares: [] as string[],
    },
    deploy: {
        namespace: 'default',
        registry: 'pc10.yff.me',
        baseImage: 'pc10.yff.me/node:14',
        kanikoImage: 'gcr.io/kaniko-project/executor:debug',
        serviceType: 'ClusterIP',
        cacheRepo: 'pc10.yff.me/kaniko/cache',
        npmConfig: undefined as any,
        s3Config: {
            region: 'us-east-1',
            s3ForcePathStyle: true,
            accessKeyId: 'minioadmin',
            secretAccessKey: 'minioadmin',
            endpoint: 'http://pc10.yff.me:9000',
            bucket: 'yff',
        },
    },
}
if (fs.existsSync(path.join(cwd, 'package.json'))) {
    const { sn } = require(path.join(cwd, 'package.json'))
    Object.assign(options, sn)
}
if (fs.existsSync(path.join(cwd, 'sn.config.js'))) {
    const { sn } = require(path.join(cwd, 'sn.config.js'))
    Object.assign(options, sn)
}

const html = ({ dev }: { dev: boolean }) => `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>App</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <script>
        // polyfill for npm 'buffer'
        window.global = window
    </script>
    ${
        dev && `
    <script>
        window.__SN_DEV__ = true
    </script>
    <script type="module">
        // https://vitejs.dev/guide/backend-integration.html
        import RefreshRuntime from '/@react-refresh'
        RefreshRuntime.injectIntoGlobalHook(window)
        window.$RefreshReg$ = () => {}
        window.$RefreshSig$ = () => (type) => type
        window.__vite_plugin_react_preamble_installed__ = true
        // https://github.com/vitejs/vite/issues/4786
        window.__VITE_IS_MODERN__ = true
    </script>
    <script type="module" src="/@vite/client"></script>
        ` || ''
    }
    <script type="module" src="/@yff/sn/src/bootstrap.tsx"></script>
</head>
<body></body>
</html>`

function isMod(mod: string) {
    try {
        require.resolve(mod, { paths: [cwd] })
        return true
    } catch (err: any) {
        if (err.code === 'MODULE_NOT_FOUND') {
            return false
        } else {
            throw err
        }
    }
}

async function isTsMod(mod: string) {
    try {
        await exec(`npx ts-node -e 'require("${mod}")'`)
        return true
    } catch (err) {
        return false
    }
}

async function prepareDirectory() {
    if (!(await fs.exists(path.join(options.pages, 'index.tsx')))) {
        await mkdirp(options.pages)
        await fs.copyFile(path.join(__dirname, '..', 'src', 'pages', 'index.tsx'), path.join(options.pages, 'index.tsx'))
    }
    if (!(await fs.exists(path.join(options.lambda, 'index.ts')))) {
        await mkdirp(options.lambda)
        await fs.copyFile(path.join(__dirname, '..', 'src', 'lambda', 'index.ts'), path.join(options.lambda, 'index.ts'))
    }
    const deps = [
        'react',
        'vue',
        'react-router-dom',
    ].filter(mod => !isMod(mod))
    if (deps.length) {
        console.log(`PREPARE: npm i -S ${deps.join(' ')}`)
        await exec(`npm i -S ${deps.join(' ')}`)
    }
    const devDeps = [] as string[]
    for (const mod of [
        '@types/react',
        '@types/node',
        '@types/react-router-dom',
    ]) {
        if (!(await isTsMod(mod))) {
            devDeps.push(mod)
        }
    }
    if (devDeps.length) {
        console.log(`PREPARE: npm i -D ${devDeps.join(' ')}`)
        await exec(`npm i -D ${devDeps.join(' ')}`)
    }
}

function createServer(app: koa) {
    const { key, cert } = options.http2 || { }
    return options.http2 ?
        http2.createSecureServer({
            ...options.http2,
            key:  typeof key  === 'string' ? fs.readFileSync(key)  : key,
            cert: typeof cert === 'string' ? fs.readFileSync(cert) : cert,
        }, app.callback()) :
        http.createServer(app.callback())
}

program.action(runAsyncOrExit(async function() {
    await prepareDirectory()
    const modules = getModules(options, [cwd]),
        router = new route(),
        app = new koa(),
        emitter = new Emitter(options.emitter),
        middlewares = getMiddlewares(options.middlewares, [cwd]),
        upload = multer({ limits: { fileSize: 10 * 1024 ** 3 } })
    router.post(/^\/rpc(?:\/|$)/, upload.any(), ctx => rpc(ctx, emitter, modules, middlewares))

    const hot = getHotMod(options.lambda)
    Object.defineProperty(modules[''], 'mod', {
        get() { return hot.mod }
    })
    hot.evt.on('change', file => {
        console.log(`[TS] file ${file} changed`)
    })
    hot.evt.on('reload', () => {
        emitter.emit('watch', { reload: true })
    })

    const viteServer = await vite.createServer({
        server: { port: parseInt(options.port), middlewareMode: true },
        plugins: [react(), vitePlugin(options, modules)],
        optimizeDeps: { include: ['socket.io-client'] }
    })
    app.use(connect(viteServer.middlewares))
    app.use(parser())
    app.use(router.routes())
    app.use(router.allowedMethods())
    app.use(ctx => ctx.body = html({ dev: true }))

    const server = createServer(app),
        io = new Server(server as any)
    io.on('connect', ws => {
        const cbs = { } as Record<string, (data: any) => any>,
            func = (evt: string) => cbs[evt] || (cbs[evt] = data => ws.emit(evt, data))
        ws.on('join',  (evt, cb) => (emitter.on(evt, func(evt)), cb?.()))
        ws.on('leave', (evt, cb) => (emitter.off(evt, func(evt)), cb?.()))
        ws.on('send', ({ evt, data }) => io.to(evt).emit(evt, data))
    })

    server.listen(parseInt(options.port), () => {
        console.log(`[EX] listening ${JSON.stringify(server.address())}`)
    })
}))

program.command('remove').action(runAsyncOrExit(async function() {
    const { name } = require(path.join(cwd, 'package.json')) as { name: string, version: string }
    await cluster.remove({ name, namespace: options.deploy.namespace })
}))

program.command('deploy').action(runAsyncOrExit(async function() {
    const { npmConfig, namespace, registry, serviceType } = options.deploy
    if (!npmConfig) {
        console.log(`INFO: getting registry from npm config list`)
        const [stdout] = await exec(`npm config list --json`),
            npmrc = JSON.parse(stdout),
            config = options.deploy.npmConfig = { } as any
        for (const key in npmrc) {
            if (key.includes('registry')) {
                config[key] = npmrc[key]
            }
        }
    }

    console.log(`INFO: building in namespace ${namespace}...`)
    const { name, version } = require(path.join(cwd, 'package.json')) as { name: string, version: string },
        image = `${registry}/${name.replace(/@/g, '')}:${version}`
    await kaniko.build({ ...options.deploy, namespace, image })

    console.log(`INFO: deploying ${image} to namespace ${namespace}...`)
    const app = name.replace(/@/g, '').replace(/\W/g, '-'),
        pubsub = app + '-pubsub',
        port = parseInt(options.port)
    await cluster.deploy({
        namespace, image, port,
        app,
        name: app,
        type: serviceType,
        env: { SN_DEPLOY_PUBSUB: `ws://${pubsub}:${port}` }
    })
    await cluster.deployPubsub({
        namespace, image, port,
        app: pubsub,
        name: pubsub,
        type: 'ClusterIP',
        env: { SN_SERVE_PUBSUB: '1' }
    })

    console.log(`INFO: deployed image ${image} as ${app} in namespace ${namespace}`)
}))

program.command('build').action(runAsyncOrExit(async function () {
    const modules = getModules(options, [cwd]),
        hasIndexHtml = await fs.exists('index.html')
    if (!hasIndexHtml) {
        await fs.writeFile('index.html', html({ dev: false }))
    }
    await vite.build({
        plugins: [react(), vitePlugin(options, modules)],
        optimizeDeps: { include: ['socket.io-client'] }
    })
    if (!hasIndexHtml) {
        await fs.unlink('index.html')
    }
    await exec('npx tsc')
}))

program.command('start').action(runAsyncOrExit(async function() {
    const modules = getModules(options, [cwd]),
        emitter = new Emitter(options.emitter || process.env.SN_DEPLOY_PUBSUB),
        middlewares = getMiddlewares(options.middlewares, [cwd]),
        upload = multer({ limits: { fileSize: 10 * 1024 ** 3 } }),
        router = new route(),
        app = new koa()
    router.post(/^\/rpc(?:\/|$)/, upload.any(), ctx => rpc(ctx, emitter, modules, middlewares))

    app.use(parser())
    app.use(router.routes())
    app.use(router.allowedMethods())
    app.use(serve('dist'))
    app.use(ctx => ctx.res.end(html({ dev: false })))

    const server = createServer(app),
        io = new Server(server as any)
    io.on('connect', ws => {
        const cbs = { } as Record<string, (data: any) => any>,
            func = (evt: string) => cbs[evt] || (cbs[evt] = data => ws.emit(evt, data))
        ws.on('join',  (evt, cb) => (emitter.on(evt, func(evt)), cb?.()))
        ws.on('leave', (evt, cb) => (emitter.off(evt, func(evt)), cb?.()))
        ws.on('send', ({ evt, data }) => io.to(evt).emit(evt, data))
    })

    server.listen(parseInt(options.port), () => {
        console.log(`[EX] listening ${JSON.stringify(server.address())}`)
    })
}))

program.command('pip <res>').action(runAsyncOrExit(async function (res) {
    const modules = getModules(options, [cwd]),
        emitter = new Emitter(options.emitter || process.env.SN_DEPLOY_PUBSUB),
        middlewares = getMiddlewares(options.middlewares, [cwd])
    await pip(res, emitter, modules, middlewares)
    process.exit(0)
}))

program.on('command:*', () => {
    program.outputHelp()
    process.exit(1)
})

program.parse(process.argv)
