#!/usr/bin/env node

import fs from 'mz/fs'
import path from 'path'
import http from 'http'
import express, { Request, Response } from 'express'
import parser from 'body-parser'
import mkdirp from 'mkdirp'
import program from 'commander'
import fetch from 'node-fetch'
import { exec, fork } from 'mz/child_process'
import { Server } from 'socket.io'

import ts from 'typescript'
import webpack from 'webpack'
import WebpackDevMiddleware from 'webpack-dev-middleware'
import WebpackHotMiddleware from 'webpack-hot-middleware'

import rpc from './wrapper/express'
import { getHotMod, getMiddlewares, getModules } from './utils/module'
import { cluster, kaniko } from './utils/kube'
import { getWebpackConfig } from './utils/webpack'
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
    webpack: fs.existsSync(path.join(cwd, 'webpack.config.js')) ? path.join(cwd, 'webpack.config.js') : undefined,
    pages: path.join(cwd, 'src', 'pages'),
    lambda: path.join(cwd, 'src', 'lambda'),
    include: { } as { [key: string]: string },
    middlewares: [ ] as string[],
    port: '8080',
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
    emitter.on(evt, function send(data) {
        res.write(`data: ${JSON.stringify(data)}\n\n`)
        if (data.done) {
            emitter.off(evt, send)
            res.end()
        }
    })
}

function html(req: Request, res: Response, script: string) {
    req
    res.send(`<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>App</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <script>window.SN_DEPLOY_IMAGE="${process.env.SN_DEPLOY_IMAGE || ''}"</script>
    <script>window.SN_DEPLOY_NAMESPACE="${process.env.SN_DEPLOY_NAMESPACE || 'default'}"</script>
    <script defer src="${script}"></script>
</head>
<body></body>
</html>`)
}

async function pip(req: Request, res: Response, emitter: Emitter) {
    const { evt, url, name, namespace, image, entry, args, prefix, ack, err, value, done } = req.body
    if (url) {
        if (image) {
            const pod = `exe-${evt}`,
                command = ['npx', 'sn', 'pip', evt, url]
            await cluster.fork({ image, namespace, command, name: pod })
        } else {
            fork(__filename, ['pip', evt, url])
        }
        const ack = await emitter.next(`ack-${evt}`)
        emitter.emit(`req-${evt}`, { entry, args, prefix })
        res.send(ack)
    } else if (ack) {
        const defer = emitter.next(`req-${evt}`)
        emitter.emit(`ack-${evt}`, ack)
        res.send(await defer)
    } else {
        emitter.emit(evt, { err, value, done })
        res.send({ })
        if (done && name) {
            await cluster.kill({ name, namespace })
        }
    }
}

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
    } catch (err) {
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
    const tsconfig = getTsConfig(),
        modules = getModules(options, [cwd]),
        config = getWebpackConfig(modules, tsconfig, 'development', options.webpack),
        compiler = webpack(config),
        app = express()
    app.use(parser.json())
    app.use(WebpackDevMiddleware(compiler))
    app.use(WebpackHotMiddleware(compiler))

    const emitter = new Emitter(),
        middlewares = getMiddlewares(options.middlewares, [cwd])
    app.post('/rpc/*', (req, res) => rpc(req, res, modules, emitter, middlewares))
    app.post('/pip/*', (req, res) => pip(req, res, emitter))
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

    const { output = { } } = config
    app.use((req, res) => html(req, res, `${output.publicPath}${output.filename}`))

    const server = http.createServer(app),
        io = new Server(server)
    io.on('connect', ws => {
        ws.on('join', evt => ws.join(evt))
        ws.on('leave', evt => ws.leave(evt))
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
    const app = name.replace(/@/g, '').replace(/\W/g, '-')
    await cluster.deploy({ namespace, image, app, name: app, type: serviceType })

    console.log(`INFO: deployed image ${image} as ${app} in namespace ${namespace}`)
}))

program.command('build').action(runAsyncOrExit(async function () {
    const tsconfig = await getTsConfig(),
        modules = getModules(options, [cwd]),
        config = getWebpackConfig(modules, tsconfig, 'production', options.webpack),
        compiler = webpack(config)
    await new Promise((resolve, reject) => compiler.run(err => err ? reject(err) : resolve(null)))
    const program = ts.createProgram([require.resolve(options.lambda)], tsconfig),
        emit = program.emit(),
        diags = ts.getPreEmitDiagnostics(program).concat(emit.diagnostics)
    for (const diagnostic of diags) {
        if (diagnostic.file) {
            let { line, character } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start!)
            let message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")
            console.log(`${diagnostic.file.fileName} (${line + 1}, ${character + 1}): ${message}`)
        } else {
            console.log(ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"))
        }
    }
    if (emit.emitSkipped) {
        throw Error(`tsc existed with code 1`)
    }
}))

program.command('start').action(runAsyncOrExit(async function() {
    const app = express()
    app.use(parser.json())

    const tsconfig = await getTsConfig(),
        modules = getModules(options, [cwd]),
        emitter = new Emitter(),
        middlewares = getMiddlewares(options.middlewares, [cwd])
    app.post('/rpc/*', (req, res) => rpc(req, res, modules, emitter, middlewares))
    app.post('/pip/*', (req, res) => pip(req, res, emitter))
    app.get('/sse/:evt', (req, res) => sse(req, res, emitter))

    const { output = { } } = getWebpackConfig(modules, tsconfig, 'production', options.webpack)
    app.use(express.static(output.path || 'dist'))
    app.use((req, res) => html(req, res, `/${output.filename}`))

    const server = http.createServer(app)
    server.listen(8080, () => {
        console.log(`[EX] listening ${JSON.stringify(server.address())}`)
    })
}))

program.command('pip <evt> <url>').action(runAsyncOrExit(async function(evt: string, url: string) {
    async function emit(data: any) {
        const method = 'POST',
            headers = { Accept: 'application/json', 'Content-Type': 'application/json' },
            req = await fetch(url, { method, headers, body: JSON.stringify({ evt, ...data }) })
        return await req.json()
    }
    try {
        const modules = getModules(options, [cwd]),
            { entry, args, prefix } = await emit({ ack: { pid: process.pid } }) as { entry: string[], args: any[], prefix: string },
            [func, obj] = entry.reduce(([api], key) => [(api as any)[key], api], [modules[prefix], null]) as any
        for await (const value of func.apply(obj, args)) {
            await emit({ value })
        }
    } catch (err) {
        const { message, name } = err || { }
        await emit({ err: { ...err, message, name } })
    }
    const name = process.env.SN_FORK_NAME,
        namespace = process.env.SN_FORK_NAMESPACE || 'default'
    await emit({ name, namespace, done: true })
    process.exit()
}))

program.on('command:*', () => {
    program.outputHelp()
    process.exit(1)
})

program.parse(process.argv)
