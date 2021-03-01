#!/usr/bin/env node

import fs from 'mz/fs'
import path from 'path'
import http from 'http'
import express, { Request, Response } from 'express'
import parser from 'body-parser'
import program from 'commander'
import EventEmitter from 'events'
import fetch from 'node-fetch'
import { exec } from 'mz/child_process'

import ts from 'typescript'
import webpack from 'webpack'
import WebpackDevMiddleware from 'webpack-dev-middleware'
import WebpackHotMiddleware from 'webpack-hot-middleware'

import call from './wrapper/express'
import { getHotMod } from './utils/module'
import { cluster, kaniko } from './utils/kube'
import { getWebpackConfig } from './utils/webpack'

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

function handleSSE(sse: EventEmitter, retry = 0) {
    return async (req: Request, res: Response) => {
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
        sse.on(evt, function send(data) {
            res.write(`data: ${JSON.stringify(data)}\n\n`)
            if (data.done) {
                sse.off(evt, send)
                res.end()
            }
        })
    }
}

function handleHtml(script: string) {
    return (req: Request, res: Response) => {
        req
        res.send(`<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>App</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <script defer src="${script}"></script>
</head>
<body></body>
</html>`)
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
    const config = getWebpackConfig(opts.webpack, opts.pages, 'development'),
        compiler = webpack(config),
        app = express()
    app.use(parser.json())
    app.use(WebpackDevMiddleware(compiler))
    app.use(WebpackHotMiddleware(compiler))

    const hot = await fs.exists(opts.api) ? getHotMod(opts.api) : { mod: { }, evt: new EventEmitter() }
    app.post('/rpc/*', (req, res) => call(req, res, hot.mod, sse))
    hot.evt.on('change', file => {
        console.log(`[TS] file ${file} changed`)
    })
    hot.evt.on('reload', () => {
        sse.emit('watch', { reload: true })
    })

    const sse = new EventEmitter()
    app.get('/sse/:evt', handleSSE(sse))

    const { output = { } } = config
    app.use(handleHtml(`${output.publicPath}${output.filename}`))

    const server = http.createServer(app)
    server.listen(parseInt(opts.port), () => {
        console.log(`[EX] listening ${JSON.stringify(server.address())}`)
    })
}))

program
    .command('deploy')
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
    const config = getWebpackConfig(options.webpack, options.pages, 'production'),
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
        mod = require(path.join(tsconfig.outDir || 'dist', 'lambda')).default
    app.post('/rpc/*', (req, res) => call(req, res, mod, sse))

    const sse = new EventEmitter()
    app.get('/sse/:evt', handleSSE(sse))

    const { output = { } } = getWebpackConfig(options.webpack, options.pages, 'production')
    app.use(express.static(output.path || 'dist'))
    app.use(handleHtml(`/${output.filename}`))

    const server = http.createServer(app)
    server.listen(8080, () => {
        console.log(`[EX] listening ${JSON.stringify(server.address())}`)
    })
}))

program
    .command('stream <url>')
    .action(runAsyncOrExit(async function(url: string) {
    const method = 'POST',
        headers = { Accept: 'application/json', 'Content-Type': 'application/json' }
    try {
        const tsconfig = await getTsConfig(),
            mod = require(path.join(tsconfig.outDir || 'dist', 'lambda')).default,
            res = await fetch(url),
            { entry, args } = await res.json() as { entry: string[], args: any[] },
            obj = entry.reduce((api, key) => (api as any)[key], mod) as any
        for await (const value of obj(...args)) {
            await fetch(url, { method, headers, body: JSON.stringify({ value }) })
        }
    } catch (err) {
        await fetch(url, { method, headers, body: JSON.stringify({ err }) })
    }
    await fetch(url, { method, headers, body: JSON.stringify({ done: true }) })
}))

program.on('command:*', () => {
    program.outputHelp()
    process.exit(1)
})

program.parse(process.argv)
