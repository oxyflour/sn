#!/usr/bin/env node

import fs from 'mz/fs'
import path from 'path'
import http from 'http'
import express, { Request, Response } from 'express'
import parser from 'body-parser'
import program from 'commander'
import fetch from 'node-fetch'
import { exec, fork } from 'mz/child_process'

import ts from 'typescript'
import webpack from 'webpack'
import WebpackDevMiddleware from 'webpack-dev-middleware'
import WebpackHotMiddleware from 'webpack-hot-middleware'

import rpc from './wrapper/express'
import { getHotMod } from './utils/module'
import { cluster, kaniko } from './utils/kube'
import { getWebpackConfig } from './utils/webpack'
import Store from './utils/store'
import Emitter from './utils/emitter'

const { name, version } = require(path.join(__dirname, '..', 'package.json'))
program.version(version).name(name)

function runAsyncOrExit(fn: (...args: any[]) => Promise<void>) {
    return (...args: any[]) => fn(...args)
        .catch(err => {
            console.error(err)
            process.exit(1)
        })
}

const options = {
    webpack: path.join(process.cwd(), 'webpack.config.js'),
    pages: path.join(process.cwd(), 'src', 'pages'),
    api: path.join(process.cwd(), 'src', 'lambda'),
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
if (fs.existsSync(path.join(process.cwd(), 'package.json'))) {
    const { sn } = require(path.join(process.cwd(), 'package.json'))
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

const store = new Store(options.deploy.s3Config)
async function pip(req: Request, res: Response, emitter: Emitter) {
    const { evt, url, name, namespace, image, entry, args, ack, err, value, done } = req.body
    if (url) {
        await store.set(`pip/${evt}`, { entry, args })
        if (image) {
            const pod = `exe-${evt}`,
                command = ['npx', 'sn', 'pip', evt, url]
            await cluster.fork({ image, namespace, command, name: pod })
        } else {
            fork(__filename, ['pip', evt, url])
        }
        res.send(await new Promise(resolve => emitter.once(`ack-${evt}`, resolve)))
    } else if (ack) {
        emitter.emit(`ack-${evt}`, ack)
        res.send(await store.get(`pip/${evt}`))
        await store.del(`pip/${evt}`)
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
    require('ts-node/register')
    const { options: tsconfig } = ts.convertCompilerOptionsFromJson(json.compilerOptions, process.cwd())
    return tsconfig
}

program
    .option('-c, --webpack <file>', 'webpack config file', options.webpack)
    .option('-P, --pages <path>', 'pages path', options.pages)
    .option('-a, --api <path>', 'api path', options.api)
    .option('-p, --port <number>', 'listen port', options.port)
    .action(runAsyncOrExit(async function(opts: typeof options) {
    const config = getWebpackConfig(opts.webpack, opts.pages, opts.api, 'development'),
        compiler = webpack(config),
        app = express()
    app.use(parser.json())
    app.use(WebpackDevMiddleware(compiler))
    app.use(WebpackHotMiddleware(compiler))

    const hot = await fs.exists(opts.api) ? getHotMod(opts.api) : { mod: { }, evt: new Emitter() },
        emitter = new Emitter()
    app.post('/rpc/*', (req, res) => rpc(req, res, hot.mod, emitter))
    app.post('/pip/*', (req, res) => pip(req, res, emitter))
    app.get('/sse/:evt', (req, res) => sse(req, res, emitter))

    hot.evt.on('change', file => {
        console.log(`[TS] file ${file} changed`)
    })
    hot.evt.on('reload', () => {
        emitter.emit('watch', { reload: true })
    })

    const { output = { } } = config
    app.use((req, res) => html(req, res, `${output.publicPath}${output.filename}`))

    const server = http.createServer(app)
    server.listen(parseInt(opts.port), () => {
        console.log(`[EX] listening ${JSON.stringify(server.address())}`)
    })
}))

program
    .command('remove')
    .option('-n, --namespace <namespace>', 'namespace', options.deploy.namespace)
    .action(runAsyncOrExit(async function({ namespace }: typeof options['deploy']) {
    const { name } = require(path.join(process.cwd(), 'package.json')) as { name: string, version: string }
    await cluster.remove({ name, namespace })
}))

program
    .command('deploy')
    .option('-n, --namespace <namespace>', 'namespace', options.deploy.namespace)
    .option('-r, --registry <path>', 'registry host', options.deploy.registry)
    .option('-t, --serviceType <type>', 'ClusterIP, NodePort or LoadBalancer', options.deploy.serviceType)
    .action(runAsyncOrExit(async function({ namespace, registry, serviceType }: typeof options['deploy']) {
    if (!options.deploy.npmConfig) {
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
    const { name, version } = require(path.join(process.cwd(), 'package.json')) as { name: string, version: string },
        image = `${registry}/${name.replace(/@/g, '')}:${version}`
    await kaniko.build({ ...options.deploy, namespace, image })

    console.log(`INFO: deploying ${image} to namespace ${namespace}...`)
    const app = name.replace(/@/g, '').replace(/\W/g, '-')
    await cluster.deploy({ namespace, image, app, name: app, type: serviceType })

    console.log(`INFO: deployed image ${image} as ${app} in namespace ${namespace}`)
}))

program
    .command('build')
    .action(runAsyncOrExit(async function () {
    const config = getWebpackConfig(options.webpack, options.pages, options.api, 'production'),
        compiler = webpack(config)
    await new Promise((resolve, reject) => compiler.run(err => err ? reject(err) : resolve(null)))
    const tsconfig = await getTsConfig(),
        program = ts.createProgram([require.resolve(options.api)], tsconfig),
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

program
    .command('start')
    .action(runAsyncOrExit(async function() {
    const app = express()
    app.use(parser.json())

    const tsconfig = await getTsConfig(),
        mod = require(path.join(tsconfig.outDir || 'dist', 'lambda')).default,
        emitter = new Emitter()
    app.post('/rpc/*', (req, res) => rpc(req, res, mod, emitter))
    app.post('/pip/*', (req, res) => pip(req, res, emitter))
    app.get('/sse/:evt', (req, res) => sse(req, res, emitter))

    const { output = { } } = getWebpackConfig(options.webpack, options.pages, options.api, 'production')
    app.use(express.static(output.path || 'dist'))
    app.use((req, res) => html(req, res, `/${output.filename}`))

    const server = http.createServer(app)
    server.listen(8080, () => {
        console.log(`[EX] listening ${JSON.stringify(server.address())}`)
    })
}))

program
    .command('pip <evt> <url>')
    .action(runAsyncOrExit(async function(evt: string, url: string) {
    async function emit(data: any) {
        const method = 'POST',
            headers = { Accept: 'application/json', 'Content-Type': 'application/json' },
            req = await fetch(url, { method, headers, body: JSON.stringify({ evt, ...data }) })
        return await req.json()
    }
    try {
        const tsconfig = await getTsConfig(),
            mod = require(path.join(tsconfig.outDir || 'dist', 'lambda')).default,
            { entry, args } = await emit({ ack: { pid: process.pid } }) as { entry: string[], args: any[] },
            obj = entry.reduce((api, key) => (api as any)[key], mod) as any
        for await (const value of obj(...args)) {
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
