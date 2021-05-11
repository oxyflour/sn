import fs from 'fs'
import path from 'path'
import { EventEmitter } from 'events'
import { debounce } from './common'

function walkMod(filename: string, func: (mod: NodeModule) => void,
        visited = { } as { [filename: string]: boolean }) {
    const mod = require.cache[filename]
    if (mod && !visited[filename]) {
        visited[filename] = true
        func(mod)
        for (const { filename } of mod ? mod.children : []) {
            walkMod(filename, func, visited)
        }
    }
}

export function getHotMod(path: string) {
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

export function getModules({ pages, lambda, include }: { pages: string, lambda: string, include: { [key: string]: string } }, paths: string[]) {
    const modules = { } as { [key: string]: { pages: string, lambda: string, mod: any } }
    modules[''] = { pages, lambda, mod: require(lambda).default }
    for (const [prefix, mod] of Object.entries(include)) {
        const pkg = require.resolve(path.join(mod, 'package.json'), { paths }),
            { sn = { } } = require(pkg),
            pages = path.join(pkg, '..', sn.pages || 'src/pages'),
            lambda = path.join(pkg, '..', sn.lambda || 'src/lambda')
        modules[prefix] = { pages, lambda, mod: require(lambda).default }
    }
    return modules
}

export function getMiddlewares(middlewares: string[], paths: string[]) {
    return middlewares.map(item => require(require.resolve(item, { paths })).default)
}
