#!/usr/bin/env node

import fs from 'mz/fs'
import path from 'path'
import http from 'http'
import express, { Request, Response } from 'express'
import mkdirp from 'mkdirp'
import program from 'commander'
import multer from 'multer'
import { exec } from 'mz/child_process'
import { json } from 'body-parser'
import { Server } from 'socket.io'

import ts from 'typescript'
import react from '@vitejs/plugin-react'
import * as vite from 'vite'

import vitePlugin from './utils/vite'
import { pip, rpc } from './wrapper/express'
import { getHotMod, getMiddlewares, getModules } from './utils/module'
import { cluster, kaniko } from './utils/kube'
import Emitter from './utils/emitter'

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

async function sse(req: Request, res: Response, emitter: Emitter, retry = 0) {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
    })
    const evt = req.params.evt + ''
    if (retry) {
        res.write(`retry: ${retry}\n\n`)
    }
    function send(data: any) {
        res.write(`data: ${JSON.stringify(data)}\n\n`)
        if (data.done) {
            res.end()
        }
    }
    emitter.emit(`sse.open.${evt}`, { })
    emitter.on(evt, send)
    res.on('close', () => {
        emitter.off(evt, send)
        emitter.emit(`sse.close.${evt}`, { })
    })
}

const bootstrapPath = path.join(__dirname, '..', 'src', 'bootstrap.tsx'),
    entryPath = './' + path.relative(process.cwd(), bootstrapPath).replace(/\\/g, '/'),
    html = `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>App</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
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
    <script type="module" src="${entryPath}"></script>
</head>
<body></body>
</html>`

async function getTsConfig() {
    const configPath = ts.findConfigFile('./', ts.sys.fileExists, 'tsconfig.json') || path.join(__dirname, '..', 'tsconfig.json'),
        { config: json, error } = ts.parseConfigFileTextToJson(configPath, await fs.readFile(configPath, 'utf8'))
    if (error || !json) {
        throw Error(`parse ${configPath} failed`)
    }
    return ts.convertCompilerOptionsFromJson(json.compilerOptions, cwd).options
}

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

async function prepareDirectory() {
    if (!(await fs.exists(path.join(cwd, 'tsconfig.json')))) {
        await fs.copyFile(path.join(__dirname, '..', 'tsconfig.json'), path.join(cwd, 'tsconfig.json'))
    }
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
        await exec(`npm i -S ${deps.join(' ')}`)
    }
    const devDeps = [
        '@types/react',
        '@types/node',
        '@types/react-router-dom',
    ].filter(mod => !fs.existsSync(path.join(cwd, 'node_modules', mod)))
    if (devDeps.length) {
        await exec(`npm i -D ${devDeps.join(' ')}`)
    }
}

program.action(runAsyncOrExit(async function() {
    await prepareDirectory()
    const modules = getModules(options, [cwd]),
        app = express(),
        emitter = new Emitter(options.emitter),
        middlewares = getMiddlewares(options.middlewares, [cwd]),
        upload = multer({ limits: { fileSize: 1024 ** 3 } })
    app.use(json())
    app.post('/rpc/*', upload.any(), (req, res) => rpc(req, res, emitter, modules, middlewares))
    app.get('/sse/:evt', (req, res) => sse(req, res, emitter))

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
        plugins: [react(), vitePlugin(options, modules)]
    })
    app.use(viteServer.middlewares)
    app.use((_, res) => res.send(html))

    const server = http.createServer(app)
    {
        const io = new Server(server)
        io.on('connect', ws => {
            ws.on('join', evt => ws.join(evt))
            ws.on('leave', evt => ws.leave(evt))
            ws.on('send', ({ evt, data }) => io.to(evt).emit(evt, data))
        })
    }

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
    const tsconfig = await getTsConfig(),
        modules = getModules(options, [cwd])
    await vite.build({
        // https://github.com/vitejs/vite/issues/712
        esbuild: { jsxInject: 'import React from "react"' },
        plugins: [react(), vitePlugin(options, modules)]
    })

    const program = ts.createProgram([require.resolve(options.lambda)], tsconfig),
        emit = program.emit(),
        diags = ts.getPreEmitDiagnostics(program).concat(emit.diagnostics)
    if (!(await fs.exists('index.html'))) {
        await fs.writeFile('index.html', html)
    }
    for (const diagnostic of diags) {
        if (diagnostic.file) {
            let { line, character } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start!)
            let message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")
            console.log(`${diagnostic.file.fileName} (${line + 1}, ${character + 1}): ${message}`)
        } else {
            console.log(ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"))
        }
    }
    await fs.unlink('index.html')
    if (emit.emitSkipped) {
        throw Error(`tsc existed with code 1`)
    }
}))

program.command('start').action(runAsyncOrExit(async function() {
    const modules = getModules(options, [cwd]),
        emitter = new Emitter(options.emitter || process.env.SN_DEPLOY_PUBSUB),
        middlewares = getMiddlewares(options.middlewares, [cwd]),
        upload = multer({ limits: { fileSize: 1024 ** 3 } }),
        app = express()
    app.use(json())
    app.post('/rpc/*', upload.any(), (req, res) => rpc(req, res, emitter, modules, middlewares))
    app.get('/sse/:evt', (req, res) => sse(req, res, emitter))
    app.use(express.static('dist'))
    app.use((_, res) => res.sendFile(path.join(__dirname, 'index.html')))

    const server = http.createServer(app)
    if (process.env.SN_SERVE_PUBSUB) {
        const io = new Server(server)
        io.on('connect', ws => {
            ws.on('join', evt => ws.join(evt))
            ws.on('leave', evt => ws.leave(evt))
            ws.on('send', ({ evt, data }) => io.to(evt).emit(evt, data))
        })
    }

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
