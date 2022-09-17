import { hookFunc } from '../utils/common'
import io from 'socket.io-client/build/esm'
import form from './form'

const ws = io({ transports: ['websocket'] })
if ((window as any).__SN_DEV__) {
    ws.emit('join', 'watch')
}

export default <T extends { }>({ url = '', prefix = '', opts = { } }: {
    url?: string
    prefix?: string
    opts?: any
}) => hookFunc({ } as T, (...stack) => {
    const entry = stack.map(item => item.propKey).reverse(),
        part = entry.slice().join('/')
    return (...args: any[]) => {
        async function post(url: string, ext: any) {
            const { meta, blobs } = form.encode({ entry, args, prefix, ...opts, ...ext }),
                options = { method: 'POST', body: '' as any, headers: { } as any }
            if (blobs.length) {
                const body = options.body = new FormData()
                body.append('meta', JSON.stringify(meta))
                for (const [idx, blob] of blobs.entries()) {
                    blob instanceof File ?
                        body.append('blobs[]', blob) :
                        body.append('blobs[]', blob, '__blob_' + idx)
                }
            } else {
                options.body = JSON.stringify(meta)
                options.headers['Content-Type'] = 'application/json'
            }
            const req = await fetch(url, options)
            if (req.headers.get('Content-Type') === 'application/octet-stream') {
                return new Uint8Array(await req.arrayBuffer())
            } else {
                const { err, meta, blobs = [] } = await req.json()
                if (err) {
                    throw Object.assign(new Error(), err)
                } else {
                    return form.decode({ meta, blobs: blobs.map((blob: any) => new Uint8Array(blob)) })
                }
            }
        }

        const queue = [] as any[],
            callbacks = [] as Function[]
        let started = false
        const next = async () => {
            if (!started && (started = true)) {
                const evt = Math.random().toString(16).slice(2, 10)
                await new Promise(resolve => ws.emit('join', evt, resolve))
                ws.on(evt, function process(data: any) {
                    const func = callbacks.shift()
                    func ? func(data) : queue.push(data)
                    if (data.done) {
                        ws.emit('leave', evt)
                        ws.off(evt, process)
                    }
                })
                const target = Object.assign(new URL(location.href), { pathname: `/pip/${evt}` })
                await post(`${url}/rpc/${part}`, { evt, url: target.toString() })
            }
            const data = queue.shift() || await new Promise(func => callbacks.push(func)) as any
            if (data.err) {
                throw Object.assign(new Error(), data.err)
            }
            return data
        }

        return {
            then: (resolve: any, reject: any) =>
                post(`${url}/rpc/${part}`, { }).then(resolve, reject),
            [Symbol.asyncIterator]: () => ({ next })
        }
    }
})
