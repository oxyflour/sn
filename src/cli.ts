#!/usr/bin/env node

import fs from 'mz/fs'
import path from 'path'
import http from 'http'
import express, { Request, Response } from 'express'
import parser from 'body-parser'
import program from 'commander'
import EventEmitter from 'events'

import webpack from 'webpack'
import WebpackDevMiddleware from 'webpack-dev-middleware'
import WebpackHotMiddleware from 'webpack-hot-middleware'

import call from './wrapper/express'
import { getHotMod } from './utils/module'
import { cluster, kaniko } from './utils/kube'
import { getWebpackConfig } from './utils/webpack'

const { name, version } = require(path.join(__dirname, '..', 'package.json'))
program.version(version).name(name)

const options = {
    webpack: path.join(process.cwd(), 'webpack.config.js'),
    pages: path.join(process.cwd(), 'src', 'pages'),
    api: path.join(process.cwd(), 'src', 'lambda'),
    port: '8080',
    deploy: {
        namespace: 'default',
        registry: 'pc10.yff.me',
        base: 'pc10.yff.me/node:14',
        cacheRepo: 'pc10.yff.me/kaniko/cache',
        s3config: {
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

function handleSSE(sse: EventEmitter) {
    return async (req: Request, res: Response) => {
        req
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*'
        })
        res.write('retry: 10000\n\n')
        while (true) {
            const data = await new Promise(resolve => sse.once('data', resolve))
            res.write(`data: ${JSON.stringify(data)}\n\n`)
        }
    }
}

function handleHtml(script: string) {
    return (req: Request, res: Response) => {
        req
        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="utf-8">
                <title>Webpack App</title>
                <meta name="viewport" content="width=device-width, initial-scale=1">
                <script defer src="${script}"></script>
            </head>
            <body></body>
            </html>
        `)
    }
}

program
    .option('-c, --webpack <file>', 'webpack config file', options.webpack)
    .option('-P, --pages <path>', 'pages path', options.pages)
    .option('-a, --api <path>', 'api path', options.api)
    .option('-p, --port <number>', 'listen port', options.port)
    .action(function(opts: typeof options) {
    const config = getWebpackConfig(opts.webpack, opts.pages, 'development'),
        compiler = webpack(config),
        app = express()
    app.use(parser.json())
    app.use(WebpackDevMiddleware(compiler))
    app.use(WebpackHotMiddleware(compiler))

    const hot = fs.existsSync(opts.api) ? getHotMod(opts.api) : { mod: { }, evt: new EventEmitter() }
    app.post('/rpc/*', (req, res) => call(req, res, hot.mod))
    hot.evt.on('change', file => {
        console.log(`[TS] file ${file} changed`)
    })
    hot.evt.on('reload', () => {
        sse.emit('data', { reload: true })
    })

    const sse = new EventEmitter()
    app.get('/sse', handleSSE(sse))

    const { output = { } } = config
    app.use(handleHtml(`${output.publicPath}${output.filename}`))

    const server = http.createServer(app)
    server.listen(parseInt(opts.port), () => {
        console.log(`[EX] listening ${JSON.stringify(server.address())}`)
    })
})

program
    .command('deploy')
    .option('-n, --namespace <namespace>', 'namespace', options.deploy.namespace)
    .option('-r, --registry <path>', 'registry host', options.deploy.registry)
    .action(async function({ namespace, registry }: typeof options['deploy']) {
    try {
        const { image, name } = await kaniko.build({
            ...options.deploy,
            namespace,
            registry,
        })
        const app = name.replace(/@/g, '').replace(/\W/g, '-')
        await cluster.deploy({ namespace, image, app, name: app })
    } catch (err) {
        console.error(err)
        process.exit(1)
    }
})

program
    .command('build')
    .action(async function () {
    const config = getWebpackConfig(options.webpack, options.pages, 'production'),
        compiler = webpack(config)
    await new Promise((resolve, reject) => compiler.run(err => err ? reject(err) : resolve(null)))
})

program
    .command('start')
    .action(async function() {
    const app = express()
    app.use(parser.json())

    const mod = require(path.join(process.cwd(), 'dist', 'lambda')).default // TODO
    app.post('/rpc/*', (req, res) => call(req, res, mod))

    const sse = new EventEmitter()
    app.get('/sse', handleSSE(sse))

    const { output = { } } = getWebpackConfig(options.webpack, options.pages, 'production')
    app.use(express.static(output.path || 'dist'))
    app.use(handleHtml(`/${output.filename}`))

    const server = http.createServer(app)
    server.listen(8080, () => {
        console.log(`[EX] listening ${JSON.stringify(server.address())}`)
    })
})

program.on('command:*', () => {
    program.outputHelp()
    process.exit(1)
})

program.parse(process.argv)
