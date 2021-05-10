import fs from 'fs'
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
