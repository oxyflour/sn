#!/usr/bin/env node

import fs from 'fs'
import path from 'path'
import http from 'http'
import express from 'express'
import parser from 'body-parser'
import program from 'commander'
import EventEmitter from 'events'

import webpack from 'webpack'
import WebpackDevMiddleware from 'webpack-dev-middleware'
import WebpackHotMiddleware from 'webpack-hot-middleware'

import call from './wrapper/express'
import { debounce } from './utils'

const { name, version } = require(path.join(__dirname, '..', 'package.json'))
program.version(version).name(name)

function updateEntry(entry: webpack.Configuration['entry']) {
    const urls = [
        'webpack-hot-middleware/client?path=/__webpack_hmr&reload=true',
        path.join(__dirname, 'bootstrap'),
    ]
    if (typeof entry === 'string') {
        return [entry].concat(urls)
    } else if (typeof entry === 'object') {
        const ret = { ...entry } as any
        for (const [key, value] of Object.entries(entry)) {
            if (Array.isArray(value)) {
                ret[key] = value.concat(urls)
            } else if (typeof value === 'string') {
                ret[key] = [value].concat(urls)
            } else {
                console.warn(`ignoring entry ${ret[key]}`)
            }
        }
        return ret
    } else {
        throw Error(`only entry with type object supported, got ${typeof entry}`)
    }
}

function walkMod(filename: string, func: (mod: NodeModule) => void,
        visited = { } as { [filename: string]: boolean }) {
    const mod = require.cache[filename]
    if (mod && !visited[filename]) {
        visited[filename] = true
        func(mod)
    }
    for (const { filename } of mod ? mod.children : []) {
        walkMod(filename, func, visited)
    }
}

function getHotMod(path: string) {
    require('ts-node').register()
    const evt = new EventEmitter(),
        mod = require(path).default,
        ret = { evt, mod },
        file = require.resolve(path),
        watched = { } as { [filename: string]: boolean }
    const watch = (filename: string) => {
        if (!watched[filename] && (watched[filename] = true)) {
            fs.watchFile(filename, { persistent: true, interval: 500 }, () => {
                evt.emit('change', filename)
                reload()
            })
        }
    }
    const reload = debounce(() => {
        walkMod(file, ({ filename }) => delete require.cache[filename])
        ret.mod = require(path).default
        walkMod(file, ({ filename }) => watch(filename))
        evt.emit('reload')
    }, 100)
    walkMod(file, ({ filename }) => watch(filename))
    return ret
}

const SSE_HEADERS ={
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
} 

function runDev(opts: { config: string, api: string, port?: string }) {
    const config = require(opts.config) as webpack.Configuration
    config.mode = 'development'
    config.entry = updateEntry(config.entry || { })
    config.plugins = (config.plugins || []).concat(new webpack.HotModuleReplacementPlugin())
    if (!config.output || !config.output.publicPath) {
        throw Error(`webpack config.output.publicPath is required`)
    }

    const app = express(),
        compiler = webpack(config)
    app.use(parser.json())
    app.use(WebpackDevMiddleware(compiler))
    app.use(WebpackHotMiddleware(compiler))

    const hot = getHotMod(opts.api)
    app.post('/rpc/*', (req, res) => call(req, res, hot.mod))
    hot.evt.on('change', file => {
        console.log(`[TS] file ${file} changed`)
    })
    hot.evt.on('reload', () => {
        sse.emit('data', { reload: true })
    })

    const sse = new EventEmitter()
    app.get('/sse', async (_req, res) => {
        res.writeHead(200, SSE_HEADERS)
        res.write('retry: 10000\n\n')
        while (true) {
            const data = await new Promise(resolve => sse.once('data', resolve))
            res.write(`data: ${JSON.stringify(data)}\n\n`)
        }
    })

    const server = http.createServer(app)
    server.listen(opts.port ? parseInt(opts.port) : 8080, () => {
        console.log(`[EX] listening ${JSON.stringify(server.address())}`)
    })
}

program
    .option('-c, --config <file>', 'webpack config file', path.join(process.cwd(), 'webpack.config.js'))
    .option('-p, --port <number>', 'listen port', '8080')
    .option('-a, --api <path>', 'api path', path.join(process.cwd(), 'lambda'))
    .action(runDev)

function runDeploy() {
}

program
    .command('deploy')
    .action(runDeploy)

program.on('command:*', () => {
    program.outputHelp()
    process.exit(1)
})

program.parse(process.argv)
